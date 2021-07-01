import { Resolver } from "../../autoGeneratedTypes";
import { DbBlock, DbPage } from "../../../types/dbTypes";
import { GraphQLContext } from "../../context";
import { ApolloError } from "apollo-server-express";

export const contents: Resolver<
  Promise<DbBlock[]>,
  DbPage["properties"],
  GraphQLContext
> = async ({ contents }, _, { dataSources }) => {
  // TODO: make a getEntities DB query which can retrieve multiple in the same
  // transaction.
  const entities = await Promise.all(
    contents.map(async ({namespaceId, entityId}) => {
      return await dataSources.db.getEntity({namespaceId, id: entityId});
    })
  );

  entities.forEach((entity, i) => {
    if (!entity) {
      const { namespaceId, entityId } = contents[i];
      throw new ApolloError(`entity ${entityId} not found in namespace ${namespaceId}`, "NOT_FOUND");
    }
  });

  return entities as DbBlock[];
};
