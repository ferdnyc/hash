import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@hashintel/design-system";
import { AccountId, OwnedById } from "@local/hash-subgraph";
import {
  Box,
  listItemSecondaryActionClasses,
  ListItemText,
  Menu,
  useTheme,
} from "@mui/material";
import {
  bindMenu,
  bindTrigger,
  usePopupState,
} from "material-ui-popup-state/hooks";
import { FunctionComponent, useCallback, useContext, useState } from "react";

import { useAccountPages } from "../../../components/hooks/use-account-pages";
import { useCreatePage } from "../../../components/hooks/use-create-page";
import { WorkspaceContext } from "../../../pages/shared/workspace-context";
import { MenuItem } from "../../ui";
import { HeaderIconButton } from "./shared/header-icon-button";

export const ActionsDropdownInner: FunctionComponent<{
  accountId: AccountId;
}> = ({ accountId }) => {
  const theme = useTheme();
  const { activeWorkspace } = useContext(WorkspaceContext);
  const [loading, setLoading] = useState(false);
  const { lastRootPageIndex } = useAccountPages(accountId as OwnedById);
  const [createUntitledPage] = useCreatePage(accountId as OwnedById);
  const popupState = usePopupState({
    variant: "popover",
    popupId: "actions-dropdown-menu",
  });

  // @todo handle loading/error states properly
  const addPage = useCallback(async () => {
    if (loading) {
      return;
    }

    setLoading(true);
    try {
      await createUntitledPage(lastRootPageIndex);
    } catch (err) {
      // eslint-disable-next-line no-console -- TODO: consider using logger
      console.error("Could not create page: ", err);
    } finally {
      popupState.close();
      setLoading(false);
    }
  }, [createUntitledPage, loading, popupState, lastRootPageIndex]);

  return (
    <Box>
      <HeaderIconButton
        size="medium"
        rounded
        sx={({ palette }) => ({
          mr: 1,
          color: popupState.isOpen ? palette.common.white : palette.gray[40],
          backgroundColor: popupState.isOpen
            ? palette.blue["70"]
            : palette.gray[20],
        })}
        {...bindTrigger(popupState)}
      >
        <FontAwesomeIcon icon={faPlus} />
      </HeaderIconButton>

      <Menu
        {...bindMenu(popupState)}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        PaperProps={{
          elevation: 4,
          sx: {
            borderRadius: "6px",
            marginTop: 1,
            border: `1px solid ${theme.palette.gray["20"]}`,

            [`.${listItemSecondaryActionClasses.root}`]: {
              display: { xs: "none", md: "block" },
            },
          },
        }}
      >
        <MenuItem
          onClick={() => {
            void addPage();
            popupState.close();
          }}
        >
          <ListItemText primary="Create Page" />
        </MenuItem>
        {activeWorkspace
          ? [
              { href: "/new/entity", label: "Create Entity" },
              { href: "/new/types/entity-type", label: "Create Entity Type" },
            ].map(({ href, label }) => (
              <MenuItem key={href} href={href} onClick={popupState.close}>
                <ListItemText primary={label} />
              </MenuItem>
            ))
          : null}
      </Menu>
    </Box>
  );
};

export const ActionsDropdown: FunctionComponent = () => {
  const { activeWorkspaceAccountId } = useContext(WorkspaceContext);

  return activeWorkspaceAccountId ? (
    <ActionsDropdownInner accountId={activeWorkspaceAccountId} />
  ) : null;
};
