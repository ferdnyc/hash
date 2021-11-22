import { useMemo } from "react";
import { GetAccountsQuery } from "./../../graphql/apiTypes.gen";
import { useQuery } from "@apollo/client";
import { getAccounts } from "../../graphql/queries/account.queries";

export const useGetAccounts = () => {
  const { data, loading } = useQuery<GetAccountsQuery>(getAccounts);

  const accounts = useMemo(() => {
    if (!data) return [];
    /**
     * Filter out org accounts
     * org accounts do not have "preferredName" in their properties object
     */
    const userAccounts = data.accounts.filter(
      (account) => "preferredName" in account.properties,
    );

    return userAccounts.map((account) => {
      return {
        entityId: account.entityId,
        shortname: account.properties.shortname!,
        name:
          "preferredName" in account.properties
            ? account.properties.preferredName
            : account.properties.shortname,
      };
    });
  }, [data]);

  return {
    loading,
    data: accounts,
  };
};
