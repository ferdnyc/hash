import { useMutation } from "@apollo/client";
import { EntityId, extractOwnedByIdFromEntityId } from "@local/hash-subgraph";
import { useCallback } from "react";

import {
  UpdatePageMutation,
  UpdatePageMutationVariables,
} from "../../graphql/api-types.gen";
import { getAccountPagesTree } from "../../graphql/queries/account.queries";
import { updatePage } from "../../graphql/queries/page.queries";

export const useUpdatePageTitle = () => {
  const [updatePageFn, { loading: updatePageTitleLoading }] = useMutation<
    UpdatePageMutation,
    UpdatePageMutationVariables
  >(updatePage, { awaitRefetchQueries: true });

  const getRefetchQueries = useCallback(
    (pageEntityId: EntityId) => [
      {
        query: getAccountPagesTree,
        variables: { ownedById: extractOwnedByIdFromEntityId(pageEntityId) },
      },
    ],
    [],
  );

  const updatePageTitle = useCallback(
    async (title: string, pageEntityId: EntityId) => {
      await updatePageFn({
        variables: {
          entityId: pageEntityId,
          updatedProperties: { title },
        },
        refetchQueries: getRefetchQueries(pageEntityId),
      });
    },
    [updatePageFn, getRefetchQueries],
  );

  return [updatePageTitle, { updatePageTitleLoading }] as const;
};
