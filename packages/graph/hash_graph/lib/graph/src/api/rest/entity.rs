//! Web routes for CRU operations on entities.

use std::sync::Arc;

use axum::{
    extract::Path,
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use futures::TryFutureExt;
use serde::{Deserialize, Serialize};
use type_system::uri::VersionedUri;
use utoipa::{OpenApi, ToSchema};

use crate::{
    api::rest::{
        api_resource::RoutedResource,
        read_from_store, report_to_status_code,
        utoipa_typedef::subgraph::{
            Edges, KnowledgeGraphRootedEdges, KnowledgeGraphVertex, KnowledgeGraphVertices,
            OntologyRootedEdges, OntologyVertex, OntologyVertices, Subgraph, Vertex, Vertices,
        },
    },
    identifier::{
        knowledge::{
            EntityEditionId, EntityId, EntityIdAndTimestamp, EntityRecordId, EntityVersion,
        },
        GraphElementEditionId, GraphElementId,
    },
    knowledge::{
        Entity, EntityLinkOrder, EntityMetadata, EntityProperties, EntityQueryToken, EntityUuid,
        LinkData, LinkOrder,
    },
    provenance::{OwnedById, ProvenanceMetadata, UpdatedById},
    store::{
        error::{EntityDoesNotExist, RaceConditionOnUpdate},
        query::Filter,
        EntityStore, StorePool,
    },
    subgraph::{
        edges::{
            EdgeResolveDepths, GraphResolveDepths, KnowledgeGraphEdgeKind,
            KnowledgeGraphOutwardEdges, OntologyEdgeKind, OntologyOutwardEdges,
            OutgoingEdgeResolveDepth, SharedEdgeKind,
        },
        query::{EntityStructuralQuery, StructuralQuery},
    },
};

#[derive(OpenApi)]
#[openapi(
    paths(
        create_entity,
        get_entities_by_query,
        get_entity,
        get_latest_entities,
        update_entity,
        archive_entity
    ),
    components(
        schemas(
            OwnedById,
            UpdatedById,
            CreateEntityRequest,
            UpdateEntityRequest,
            ArchiveEntityRequest,
            EntityUuid,
            EntityId,
            EntityEditionId,
            EntityIdAndTimestamp,
            EntityMetadata,
            Entity,
            EntityLinkOrder,
            EntityProperties,
            EntityRecordId,
            EntityVersion,
            EntityStructuralQuery,
            EntityQueryToken,
            LinkData,
            LinkOrder,
            ProvenanceMetadata,
            GraphElementId,
            GraphElementEditionId,
            OntologyVertex,
            KnowledgeGraphVertex,
            Vertex,
            KnowledgeGraphVertices,
            OntologyVertices,
            Vertices,
            SharedEdgeKind,
            KnowledgeGraphEdgeKind,
            OntologyEdgeKind,
            OntologyOutwardEdges,
            KnowledgeGraphOutwardEdges,
            OntologyRootedEdges,
            KnowledgeGraphRootedEdges,
            Edges,
            GraphResolveDepths,
            EdgeResolveDepths,
            OutgoingEdgeResolveDepth,
            Subgraph,
        )
    ),
    tags(
        (name = "Entity", description = "entity management API")
    )
)]
pub struct EntityResource;

impl RoutedResource for EntityResource {
    /// Create routes for interacting with entities.
    #[expect(deprecated)]
    fn routes<P: StorePool + Send + 'static>() -> Router {
        // TODO: The URL format here is preliminary and will have to change.
        Router::new().nest(
            "/entities",
            Router::new()
                .route(
                    "/",
                    post(create_entity::<P>)
                        .get(get_latest_entities::<P>)
                        .put(update_entity::<P>),
                )
                .route("/archive", post(archive_entity::<P>))
                .route("/query", post(get_entities_by_query::<P>))
                .route("/:entity_uuid", get(get_entity::<P>)),
        )
    }
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct CreateEntityRequest {
    properties: EntityProperties,
    #[schema(value_type = String)]
    entity_type_id: VersionedUri,
    owned_by_id: OwnedById,
    entity_uuid: Option<EntityUuid>,
    actor_id: UpdatedById,
    // TODO: this could break invariants if we don't move to fractional indexing
    //  https://app.asana.com/0/1201095311341924/1202085856561975/f
    #[serde(default, skip_serializing_if = "Option::is_none")]
    link_data: Option<LinkData>,
}

#[utoipa::path(
    post,
    path = "/entities",
    request_body = CreateEntityRequest,
    tag = "Entity",
    responses(
        (status = 201, content_type = "application/json", description = "The metadata of the created entity", body = EntityMetadata),
        (status = 422, content_type = "text/plain", description = "Provided request body is invalid"),

        (status = 404, description = "Entity Type URI was not found"),
        (status = 500, description = "Store error occurred"),
    ),
)]
async fn create_entity<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    body: Json<CreateEntityRequest>,
) -> Result<Json<EntityMetadata>, StatusCode> {
    let Json(CreateEntityRequest {
        properties,
        entity_type_id,
        owned_by_id,
        entity_uuid,
        actor_id,
        link_data,
    }) = body;

    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    store
        .create_entity(
            owned_by_id,
            entity_uuid,
            None,
            actor_id,
            false,
            entity_type_id,
            properties,
            link_data,
        )
        .await
        .map_err(|report| {
            tracing::error!(error=?report, "Could not create entity");

            // Insertion/update errors are considered internal server errors.
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .map(Json)
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ArchiveEntityRequest {
    entity_id: EntityId,
    actor_id: UpdatedById,
}

#[utoipa::path(
    post,
    path = "/entities/archive",
    request_body = ArchiveEntityRequest,
    tag = "Entity",
    responses(
        (status = 200, content_type = "application/json", description = "No response"),
        (status = 422, content_type = "text/plain", description = "Provided request body is invalid"),

        (status = 404, description = "Entity could not be found"),
        (status = 500, description = "Store error occurred"),
    ),
)]
#[deprecated = "use `/entities/update` instead"]
async fn archive_entity<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    body: Json<ArchiveEntityRequest>,
) -> Result<(), StatusCode> {
    let Json(ArchiveEntityRequest {
        entity_id,
        actor_id,
    }) = body;

    // TODO: Expose temporal versions to backend
    //   see https://app.asana.com/0/0/1203444301722133/f
    let entity: Entity = read_from_store(
        pool.as_ref(),
        &Filter::for_latest_entity_by_entity_id(entity_id),
    )
    .await
    .and_then(|mut entities| entities.pop().ok_or(StatusCode::NOT_FOUND))?;

    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    store
        .update_entity(
            entity_id,
            None,
            actor_id,
            true,
            entity.metadata().entity_type_id().clone(),
            entity.properties().clone(),
            EntityLinkOrder::new(
                entity
                    .link_data()
                    .as_ref()
                    .and_then(LinkData::left_to_right_order),
                entity
                    .link_data()
                    .as_ref()
                    .and_then(LinkData::right_to_left_order),
            ),
        )
        .await
        .map_err(|report| {
            tracing::error!(error=?report, "Could not update entity");

            // Insertion/update errors are considered internal server errors.
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(())
}

#[utoipa::path(
    post,
    path = "/entities/query",
    request_body = EntityStructuralQuery,
    tag = "Entity",
    responses(
        (status = 200, content_type = "application/json", body = Subgraph, description = "A subgraph rooted at entities that satisfy the given query, each resolved to the requested depth."),
        (status = 422, content_type = "text/plain", description = "Provided query is invalid"),
        (status = 500, description = "Store error occurred"),
    )
)]
async fn get_entities_by_query<P: StorePool + Send>(
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
            store.get_entity(&query).await.map_err(|report| {
                tracing::error!(error=?report, ?query, "Could not read entities from the store");
                report_to_status_code(&report)
            })
        })
        .await
        .map(|subgraph| Json(subgraph.into()))
}

#[utoipa::path(
    get,
    path = "/entities",
    tag = "Entity",
    responses(
        (status = 200, content_type = "application/json", description = "List of all entities", body = [Entity]),

        (status = 500, description = "Store error occurred"),
    )
)]
#[deprecated = "use `/entities/query` instead"]
async fn get_latest_entities<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
) -> Result<Json<Vec<Entity>>, StatusCode> {
    read_from_store(pool.as_ref(), &Filter::for_all_latest_entities())
        .await
        .map(Json)
}

#[utoipa::path(
    get,
    path = "/entities/{entityId}",
    tag = "Entity",
    responses(
        (status = 200, content_type = "application/json", description = "The latest version of the requested entity", body = Entity),

        (status = 400, content_type = "text/plain", description = "Provided entity id is invalid"),
        (status = 404, description = "Entity was not found"),
        (status = 500, description = "Store error occurred"),
    ),
    params(
        ("entityId" = EntityId, Path, description = "The EntityId"),
    )
)]
#[deprecated = "use `/entities/query` instead"]
async fn get_entity<P: StorePool + Send>(
    Path(entity_id): Path<EntityId>,
    pool: Extension<Arc<P>>,
) -> Result<Json<Entity>, StatusCode> {
    read_from_store(
        pool.as_ref(),
        &Filter::for_latest_entity_by_entity_id(entity_id),
    )
    .await
    .and_then(|mut entities| entities.pop().ok_or(StatusCode::NOT_FOUND))
    .map(Json)
}

#[derive(ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateEntityRequest {
    properties: EntityProperties,
    entity_id: EntityId,
    #[schema(value_type = String)]
    entity_type_id: VersionedUri,
    actor_id: UpdatedById,
    #[serde(flatten)]
    order: EntityLinkOrder,
    // TODO: Remove default value when exposing temporal versions to backend
    //   see https://app.asana.com/0/0/1203444301722133/f
    #[serde(default)]
    archived: bool,
}

#[utoipa::path(
    put,
    path = "/entities",
    tag = "Entity",
    responses(
        (status = 200, content_type = "application/json", description = "The metadata of the updated entity", body = EntityMetadata),
        (status = 422, content_type = "text/plain", description = "Provided request body is invalid"),
        (status = 423, content_type = "text/plain", description = "The entity that should be updated was unexpectedly updated at the same time"),

        (status = 404, description = "Entity ID or Entity Type URI was not found"),
        (status = 500, description = "Store error occurred"),
    ),
    request_body = UpdateEntityRequest,
)]
async fn update_entity<P: StorePool + Send>(
    pool: Extension<Arc<P>>,
    body: Json<UpdateEntityRequest>,
) -> Result<Json<EntityMetadata>, StatusCode> {
    let Json(UpdateEntityRequest {
        properties,
        entity_id,
        entity_type_id,
        actor_id,
        order,
        archived,
    }) = body;

    let mut store = pool.acquire().await.map_err(|report| {
        tracing::error!(error=?report, "Could not acquire store");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    store
        .update_entity(
            entity_id,
            None,
            actor_id,
            archived,
            entity_type_id,
            properties,
            order,
        )
        .await
        .map_err(|report| {
            tracing::error!(error=?report, "Could not update entity");

            if report.contains::<EntityDoesNotExist>() {
                StatusCode::NOT_FOUND
            } else if report.contains::<RaceConditionOnUpdate>() {
                StatusCode::LOCKED
            } else {
                // Insertion/update errors are considered internal server errors.
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
        .map(Json)
}
