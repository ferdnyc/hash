import { gql } from "apollo-server-express";

export const propertyTypeTypedef = gql`
  scalar PropertyTypeWithoutId
  scalar PropertyTypeWithMetadata

  extend type Query {
    """
    Get a subgraph rooted at all property types at their latest version.
    """
    getAllLatestPropertyTypes(
      dataTypeResolveDepth: Int!
      propertyTypeResolveDepth: Int!
    ): Subgraph!

    """
    Get a subgraph rooted at an property type resolved by its versioned URI.
    """
    getPropertyType(
      propertyTypeId: VersionedUri!
      dataTypeResolveDepth: Int!
      propertyTypeResolveDepth: Int!
    ): Subgraph!
  }

  extend type Mutation {
    """
    Create a property type.
    """
    createPropertyType(
      """
      The id of the account who owns the property type. Defaults to the user calling the mutation.
      """
      ownedById: ID
      propertyType: PropertyTypeWithoutId!
    ): PropertyTypeWithMetadata!

    """
    Update a property type.
    """
    updatePropertyType(
      """
      The property type versioned $id to update.
      """
      propertyTypeId: VersionedUri!
      """
      New property type schema contents to be used.
      """
      updatedPropertyType: PropertyTypeWithoutId!
    ): PropertyTypeWithMetadata!
  }
`;
