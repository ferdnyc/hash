import { TableCell, TableRow, Typography } from "@mui/material";

import { useBlockProtocolArchiveEntity } from "../../../../components/hooks/block-protocol-functions/knowledge/use-block-protocol-archive-entity";
import { Org } from "../../../../lib/user-and-org";
import { Link } from "../../../../shared/ui/link";
import { useAuthenticatedUser } from "../../../shared/auth-info-context";
import { Cell } from "../shared/cell";
import { OrgContextMenu } from "./org-row/org-context-menu";

export const OrgRow = ({ org }: { org: Org }) => {
  const { archiveEntity } = useBlockProtocolArchiveEntity();
  const { authenticatedUser, refetch } = useAuthenticatedUser();

  const leaveOrg = async () => {
    const membership = org.memberships.find(
      (option) => option.user.accountId === authenticatedUser.accountId,
    );

    if (!membership) {
      throw new Error("Membership not found");
    }

    await archiveEntity({
      data: {
        entityId: membership.membershipEntity.metadata.recordId.entityId,
      },
    });
    void refetch();
  };

  return (
    <TableRow key={org.entityRecordId.entityId}>
      <Cell>
        <Link
          href={`/settings/organizations/${org.shortname}/general`}
          sx={{ textDecoration: "none" }}
        >
          {org.name}
        </Link>
      </Cell>
      <TableCell>
        <Typography
          variant="smallTextLabels"
          sx={({ palette }) => ({
            background: palette.gray[10],
            borderRadius: 10,
            lineHeight: 1,
            px: "10px",
            py: "4px",
            color: palette.gray[60],
            fontWeight: 500,
            whiteSpace: "nowrap",
          })}
        >
          @{org.shortname}
        </Typography>
      </TableCell>
      <TableCell>
        <OrgContextMenu leaveOrg={leaveOrg} />
      </TableCell>
    </TableRow>
  );
};
