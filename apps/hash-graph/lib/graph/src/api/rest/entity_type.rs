//! Web routes for CRU operations on Entity types.

use std::{collections::hash_map, sync::Arc};

use axum::{
    http::StatusCode,
    response::Response,
    routing::{post, put},
    Extension, Router,
};
use futures::TryFutureExt;
use graph_types::{
    ontology::{
        EntityTypeMetadata, EntityTypeWithMetadata, OntologyElementMetadata,
        OntologyTemporalMetadata, OntologyTypeReference, PartialCustomEntityTypeMetadata,
        PartialCustomOntologyMetadata, PartialEntityTypeMetadata,
    },
    provenance::{OwnedById, ProvenanceMetadata, RecordArchivedById, RecordCreatedById},
};
use hash_map::HashMap;
use serde::{Deserialize, Serialize};
use type_system::{
    url::{BaseUrl, VersionedUrl},
    EntityType, ParseEntityTypeError,
};
use utoipa::{OpenApi, ToSchema};

use crate::{
    api::{
        error::{ErrorInfo, Status, StatusPayloads},
        rest::{
            api_resource::RoutedResource,
            json::Json,
            report_to_status_code,
            status::status_to_response,
            utoipa_typedef::{subgraph::Subgraph, ListOrValue, MaybeListOfEntityType},
            RestApiStore,
        },
    },
    ontology::{
        domain_validator::{DomainValidator, ValidateOntologyType},
        patch_id_and_parse, EntityTypeQueryToken,
    },
    store::{
        error::{BaseUrlAlreadyExists, OntologyVersionDoesNotExist, VersionedUrlAlreadyExists},
        ConflictBehavior, EntityTypeStore, StorePool,
    },
    subgraph::query::{EntityTypeStructuralQuery, StructuralQuery},
};

#[derive(OpenApi)]
#[openapi(
    paths(
        create_entity_type,
        load_external_entity_type,
        get_entity_types_by_query,
        update_entity_type,
        archive_entity_type,
        unarchive_entity_type,
    ),
    components(
        schemas(
            EntityTypeWithMetadata,

            CreateEntityTypeRequest,
            LoadExternalEntityTypeRequest,
            UpdateEntityTypeRequest,
            EntityTypeQueryToken,
            EntityTypeStructuralQuery,
            ArchiveEntityTypeRequest,
            UnarchiveEntityTypeRequest,
        )
    ),
    tags(
        (name = "EntityType", description = "Entity type management API")
    )
)]
pub struct EntityTypeResource;

impl RoutedResource for EntityTypeResource {
    /// Create routes for interacting with entity types.
    fn routes<P: StorePool + Send + 'static>() -> Router
    where
        for<'pool> P::Store<'pool>: RestApiStore,
    {
        // TODO: The URL format here is preliminary and will have to change.
        Router::new().nest(
            "/entity-types",
            Router::new()
                .route(
                    "/",
                    post(create_entity_type::<P>).put(update_entity_type::<P>),
                )
                .route("/query", post(get_entity_types_by_query::<P>))
                .route("/load", post(load_external_entity_type::<P>))
                .route("/archive", put(archive_entity_type::<P>))
                .route("/unarchive", put(unarchive_entity_type::<P>)),
        )
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct CreateEntityTypeRequest {
    #[schema(inline)]
    schema: MaybeListOfEntityType,
    owned_by_id: OwnedById,
    actor_id: RecordCreatedById,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = SHARED_BaseUrl)]
    label_property: Option<BaseUrl>,
}

#[utoipa::path(
    post,
    path = "/entity-types",
    request_body = CreateEntityTypeRequest,
    tag = "EntityType",
    responses(
        (status = 200, content_type = "application/json", description = "The metadata of the created entity type", body = MaybeListOfEntityTypeMetadata),
        (status = 400, content_type = "application/json", description = "Provided request body is invalid", body = VAR_STATUS),

        (status = 409, content_type = "application/json", description = "Unable to create entity type in the datastore as the base entity type ID already exists", body = VAR_STATUS),
        (status = 500, content_type = "application/json", description = "Store error occurred", body = VAR_STATUS),
    ),
)]
#[tracing::instrument(level = "info", skip(pool, domain_validator))]
async fn create_entity_type<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    domain_validator: Extension<DomainValidator>,
    body: Json<CreateEntityTypeRequest>,
    // TODO: We want to be able to return `Status` here we should try and create a general way to
    //  call `status_to_response` for our routes that return Status
) -> Result<Json<ListOrValue<EntityTypeMetadata>>, Response>
where
    for<'pool> P::Store<'pool>: RestApiStore,
{
    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        status_to_response(Status::new(
            hash_status::StatusCode::Internal,
            Some(
                "Could not acquire store. This is an internal error, please report to the \
                 developers of the HASH Graph with whatever information you can provide including \
                 request details and logs."
                    .to_owned(),
            ),
            vec![StatusPayloads::ErrorInfo(ErrorInfo::new(
                // TODO: add information from the report here
                //   https://app.asana.com/0/1203363157432094/1203639884730779/f
                HashMap::new(),
                // TODO: We should encapsulate these Reasons within the type system, perhaps
                //  requiring top level contexts to implement a trait `ErrorReason::to_reason`
                //  or perhaps as a big enum, or as an attachment
                "STORE_ACQUISITION_FAILURE".to_owned(),
            ))],
        ))
    })?;

    let Json(CreateEntityTypeRequest {
        schema,
        owned_by_id,
        actor_id,
        label_property,
    }) = body;

    let is_list = matches!(&schema, ListOrValue::List(_));

    let schema_iter = schema.into_iter();
    let mut entity_types = Vec::with_capacity(schema_iter.size_hint().0);
    let mut partial_metadata = Vec::with_capacity(schema_iter.size_hint().0);

    for schema in schema_iter {
        let entity_type: EntityType = schema.try_into().map_err(|err: ParseEntityTypeError| {
            tracing::error!(error=?err, "Provided schema wasn't a valid entity type");
            status_to_response(Status::new(
                hash_status::StatusCode::InvalidArgument,
                Some("Provided schema wasn't a valid entity type.".to_owned()),
                vec![StatusPayloads::ErrorInfo(ErrorInfo::new(
                    HashMap::from([(
                        "validationError".to_owned(),
                        serde_json::to_value(err)
                            .expect("Could not serialize entity type validation error"),
                    )]),
                    // TODO: We should encapsulate these Reasons within the type system, perhaps
                    //  requiring top level contexts to implement a trait `ErrorReason::to_reason`
                    //  or perhaps as a big enum, or as an attachment
                    "INVALID_SCHEMA".to_owned(),
                ))],
            ))
        })?;

        domain_validator.validate(&entity_type).map_err(|report| {
            tracing::error!(error=?report, id=entity_type.id().to_string(), "Entity Type ID failed to validate");
            status_to_response(Status::new(
            hash_status::StatusCode::InvalidArgument,
            Some("Entity Type ID failed to validate against the given domain regex. Are you sure the service is able to host a type under the domain you supplied?".to_owned()),
            vec![StatusPayloads::ErrorInfo(ErrorInfo::new(
                HashMap::from([
                    (
                        "entityTypeId".to_owned(),
                        serde_json::to_value(entity_type.id().to_string())
                            .expect("Could not serialize entity type id"),
                    ),
                ]),
                // TODO: We should encapsulate these Reasons within the type system, perhaps
                //  requiring top level contexts to implement a trait `ErrorReason::to_reason`
                //  or perhaps as a big enum
                "INVALID_TYPE_ID".to_owned()
            ))],
        ))
        })?;

        partial_metadata.push(PartialEntityTypeMetadata {
            record_id: entity_type.id().clone().into(),
            custom: PartialCustomEntityTypeMetadata {
                common: PartialCustomOntologyMetadata::Owned {
                    provenance: ProvenanceMetadata {
                        record_created_by_id: actor_id,
                        record_archived_by_id: None,
                    },
                    owned_by_id,
                },
                label_property: label_property.clone(),
            },
        });

        entity_types.push(entity_type);
    }

    let mut metadata = store
        .create_entity_types(
            entity_types.into_iter().zip(partial_metadata),
            ConflictBehavior::Fail,
        )
        .await
        .map_err(|report| {
            tracing::error!(error=?report, "Could not create entity types");

            if report.contains::<BaseUrlAlreadyExists>() {
                let metadata =
                    report
                        .request_ref::<BaseUrl>()
                        .next()
                        .map_or_else(HashMap::new, |base_url| {
                            let base_url = base_url.to_string();
                            HashMap::from([(
                                "baseUrl".to_owned(),
                                serde_json::to_value(base_url)
                                    .expect("Could not serialize base url"),
                            )])
                        });

                return status_to_response(Status::new(
                    hash_status::StatusCode::AlreadyExists,
                    Some(
                        "Could not create entity type as the base URI already existed, perhaps \
                         you intended to call `updateEntityType` instead?"
                            .to_owned(),
                    ),
                    vec![StatusPayloads::ErrorInfo(ErrorInfo::new(
                        metadata,
                        // TODO: We should encapsulate these Reasons within the type system,
                        //  perhaps requiring top level contexts to implement a trait
                        //  `ErrorReason::to_reason` or perhaps as a big enum, or as an attachment
                        "BASE_URI_ALREADY_EXISTS".to_owned(),
                    ))],
                ));
            }

            // Insertion/update errors are considered internal server errors.
            status_to_response(Status::new(
                hash_status::StatusCode::Internal,
                Some(
                    "Internal error, please report to the developers of the HASH Graph with \
                     whatever information you can provide including request details and logs."
                        .to_owned(),
                ),
                vec![StatusPayloads::ErrorInfo(ErrorInfo::new(
                    HashMap::new(),
                    // TODO: We should encapsulate these Reasons within the type system, perhaps
                    //  requiring top level contexts to implement a trait
                    //  `ErrorReason::to_reason` or perhaps as a big enum, or as an attachment
                    "INTERNAL".to_owned(),
                ))],
            ))
        })?;

    if is_list {
        Ok(Json(ListOrValue::List(metadata)))
    } else {
        Ok(Json(ListOrValue::Value(
            metadata.pop().expect("metadata does not contain a value"),
        )))
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct LoadExternalEntityTypeRequest {
    #[schema(value_type = SHARED_VersionedUrl)]
    entity_type_id: VersionedUrl,
    actor_id: RecordCreatedById,
}

#[utoipa::path(
    post,
    path = "/entity-types/load",
    request_body = LoadExternalEntityTypeRequest,
    tag = "EntityType",
    responses(
        (status = 200, content_type = "application/json", description = "The metadata of the created entity type", body = OntologyElementMetadata),
        (status = 400, content_type = "application/json", description = "Provided request body is invalid", body = VAR_STATUS),

        (status = 409, content_type = "application/json", description = "Unable to load entity type in the datastore as the entity type ID already exists", body = VAR_STATUS),
        (status = 500, content_type = "application/json", description = "Store error occurred", body = VAR_STATUS),
    ),
)]
#[tracing::instrument(level = "info", skip(pool, domain_validator))]
async fn load_external_entity_type<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    domain_validator: Extension<DomainValidator>,
    body: Json<LoadExternalEntityTypeRequest>,
    // TODO: We want to be able to return `Status` here we should try and create a general way to
    //  call `status_to_response` for our routes that return Status
) -> Result<Json<OntologyElementMetadata>, Response>
where
    for<'pool> P::Store<'pool>: RestApiStore,
{
    let Json(LoadExternalEntityTypeRequest {
        entity_type_id,
        actor_id,
    }) = body;

    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        status_to_response(Status::new(
            hash_status::StatusCode::Internal,
            Some(
                "Could not acquire store. This is an internal error, please report to the \
                 developers of the HASH Graph with whatever information you can provide including \
                 request details and logs."
                    .to_owned(),
            ),
            vec![StatusPayloads::ErrorInfo(ErrorInfo::new(
                // TODO: add information from the report here
                //   https://app.asana.com/0/1203363157432094/1203639884730779/f
                HashMap::new(),
                // TODO: We should encapsulate these Reasons within the type system, perhaps
                //  requiring top level contexts to implement a trait `ErrorReason::to_reason`
                //  or perhaps as a big enum, or as an attachment
                "STORE_ACQUISITION_FAILURE".to_owned(),
            ))],
        ))
    })?;

    Ok(Json(
        store
            .load_external_type(
                &domain_validator,
                OntologyTypeReference::EntityTypeReference((&entity_type_id).into()),
                actor_id,
            )
            .await
            .map_err(|error| {
                if error == StatusCode::CONFLICT {
                    status_to_response(Status::new(
                        hash_status::StatusCode::AlreadyExists,
                        Some("Provided schema entity type does already exist.".to_owned()),
                        vec![],
                    ))
                } else {
                    status_to_response(Status::new(
                        hash_status::StatusCode::AlreadyExists,
                        Some(
                            "Unknown error occurred when loading external entity type.".to_owned(),
                        ),
                        vec![],
                    ))
                }
            })?,
    ))
}

#[utoipa::path(
    post,
    path = "/entity-types/query",
    request_body = EntityTypeStructuralQuery,
    tag = "EntityType",
    responses(
        (status = 200, content_type = "application/json", body = Subgraph, description = "A subgraph rooted at entity types that satisfy the given query, each resolved to the requested depth."),
        (status = 422, content_type = "text/plain", description = "Provided query is invalid"),
        (status = 500, description = "Store error occurred"),
    )
)]
#[tracing::instrument(level = "info", skip(pool))]
async fn get_entity_types_by_query<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    Json(query): Json<serde_json::Value>,
) -> Result<Json<Subgraph>, StatusCode> {
    pool.acquire()
        .map_err(|error| {
            tracing::error!(?error, "Could not acquire access to the store");
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .and_then(|store| async move {
            let mut query = StructuralQuery::deserialize(&query).map_err(|error| {
                tracing::error!(?error, "Could not deserialize query");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            query.filter.convert_parameters().map_err(|error| {
                tracing::error!(?error, "Could not validate query");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            store
                .get_entity_type(&query)
                .await
                .map_err(|report| {
                    tracing::error!(error=?report, ?query, "Could not read entity types from the store");
                    report_to_status_code(&report)
                })
        })
        .await
        .map(|subgraph| Json(subgraph.into()))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct UpdateEntityTypeRequest {
    #[schema(value_type = VAR_UPDATE_ENTITY_TYPE)]
    schema: serde_json::Value,
    #[schema(value_type = SHARED_VersionedUrl)]
    type_to_update: VersionedUrl,
    actor_id: RecordCreatedById,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = SHARED_BaseUrl)]
    label_property: Option<BaseUrl>,
}

#[utoipa::path(
    put,
    path = "/entity-types",
    tag = "EntityType",
    responses(
        (status = 200, content_type = "application/json", description = "The metadata of the updated entity type", body = OntologyElementMetadata),
        (status = 422, content_type = "text/plain", description = "Provided request body is invalid"),

        (status = 404, description = "Base entity type ID was not found"),
        (status = 500, description = "Store error occurred"),
    ),
    request_body = UpdateEntityTypeRequest,
)]
#[tracing::instrument(level = "info", skip(pool))]
async fn update_entity_type<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    body: Json<UpdateEntityTypeRequest>,
) -> Result<Json<EntityTypeMetadata>, StatusCode> {
    let Json(UpdateEntityTypeRequest {
        schema,
        mut type_to_update,
        actor_id,
        label_property,
    }) = body;

    type_to_update.version += 1;

    let entity_type = patch_id_and_parse(&type_to_update, schema).map_err(|report| {
        tracing::error!(error=?report, "Couldn't convert schema to Entity Type");
        // Shame there isn't an UNPROCESSABLE_ENTITY_TYPE code :D
        StatusCode::UNPROCESSABLE_ENTITY
        // TODO - We should probably return more information to the client
        //  https://app.asana.com/0/1201095311341924/1202574350052904/f
    })?;

    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    store
        .update_entity_type(entity_type, actor_id, label_property)
        .await
        .map_err(|report| {
            tracing::error!(error=?report, "Could not update entity type");

            if report.contains::<OntologyVersionDoesNotExist>() {
                return StatusCode::NOT_FOUND;
            }

            // Insertion/update errors are considered internal server errors.
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .map(Json)
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ArchiveEntityTypeRequest {
    #[schema(value_type = SHARED_VersionedUrl)]
    type_to_archive: VersionedUrl,
    actor_id: RecordArchivedById,
}

#[utoipa::path(
    put,
    path = "/entity-types/archive",
    tag = "EntityType",
    responses(
        (status = 200, content_type = "application/json", description = "The metadata of the updated entity type", body = OntologyTemporalMetadata),
        (status = 422, content_type = "text/plain", description = "Provided request body is invalid"),

        (status = 404, description = "Entity type ID was not found"),
        (status = 409, description = "Entity type ID is already archived"),
        (status = 500, description = "Store error occurred"),
    ),
    request_body = ArchiveEntityTypeRequest,
)]
#[tracing::instrument(level = "info", skip(pool))]
async fn archive_entity_type<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    body: Json<ArchiveEntityTypeRequest>,
) -> Result<Json<OntologyTemporalMetadata>, StatusCode> {
    let Json(ArchiveEntityTypeRequest {
        type_to_archive,
        actor_id,
    }) = body;

    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    store
        .archive_entity_type(&type_to_archive, actor_id)
        .await
        .map_err(|report| {
            tracing::error!(error=?report, "Could not archive entity type");

            if report.contains::<OntologyVersionDoesNotExist>() {
                return StatusCode::NOT_FOUND;
            }
            if report.contains::<VersionedUrlAlreadyExists>() {
                return StatusCode::CONFLICT;
            }

            // Insertion/update errors are considered internal server errors.
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .map(Json)
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct UnarchiveEntityTypeRequest {
    #[schema(value_type = SHARED_VersionedUrl)]
    type_to_unarchive: VersionedUrl,
    actor_id: RecordCreatedById,
}

#[utoipa::path(
    put,
    path = "/entity-types/unarchive",
    tag = "DataType",
    responses(
        (status = 200, content_type = "application/json", description = "The temporal metadata of the updated entity type", body = OntologyTemporalMetadata),
        (status = 422, content_type = "text/plain", description = "Provided request body is invalid"),

        (status = 404, description = "Entity type ID was not found"),
        (status = 409, description = "Entity type ID already exists and is not archived"),
        (status = 500, description = "Store error occurred"),
    ),
    request_body = UnarchiveEntityTypeRequest,
)]
#[tracing::instrument(level = "info", skip(pool))]
async fn unarchive_entity_type<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    body: Json<UnarchiveEntityTypeRequest>,
) -> Result<Json<OntologyTemporalMetadata>, StatusCode> {
    let Json(UnarchiveEntityTypeRequest {
        type_to_unarchive,
        actor_id,
    }) = body;

    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    store
        .unarchive_entity_type(&type_to_unarchive, actor_id)
        .await
        .map_err(|report| {
            tracing::error!(error=?report, "Could not unarchive entity type");

            if report.contains::<OntologyVersionDoesNotExist>() {
                return StatusCode::NOT_FOUND;
            }
            if report.contains::<VersionedUrlAlreadyExists>() {
                return StatusCode::CONFLICT;
            }

            // Insertion/update errors are considered internal server errors.
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .map(Json)
}
