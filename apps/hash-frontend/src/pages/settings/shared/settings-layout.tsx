import { Box, Container, Typography } from "@mui/material";
import { useRouter } from "next/router";
import { PropsWithChildren, ReactElement, useMemo } from "react";

import { Org } from "../../../lib/user-and-org";
import { PeopleGroupIcon } from "../../../shared/icons/people-group-icon";
import { LayoutWithSidebar } from "../../../shared/layout/layout-with-sidebar";
import { useAuthenticatedUser } from "../../shared/auth-info-context";
import { TopContextBar } from "../../shared/top-context-bar";
import {
  SettingsSidebar,
  SidebarItemData,
} from "./settings-layout/settings-sidebar";

const generateMenuLinks = (organizations: Org[]): SidebarItemData[] => {
  const organizationItems: SidebarItemData[] = organizations
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((org) => [
      {
        label: org.name,
        href: `/settings/organizations/${org.shortname}/general`,
        activeIfHrefStartsWith: `/settings/organizations/${org.shortname}`,
        parentHref: "/settings/organizations",
      },
      {
        label: "General",
        href: `/settings/organizations/${org.shortname}/general`,
        parentHref: `/settings/organizations/${org.shortname}`,
      },
      {
        label: "Members",
        href: `/settings/organizations/${org.shortname}/members`,
        parentHref: `/settings/organizations/${org.shortname}`,
      },
    ])
    .flat();

  const menuItems: SidebarItemData[] = [
    // { label: "Personal info", href: "/settings/personal" },
    {
      label: "Organizations",
      href: "/settings/organizations",
      icon: PeopleGroupIcon,
    },
    ...organizationItems,
  ];

  for (const item of menuItems) {
    item.children = menuItems.filter(
      (child) =>
        child.parentHref === item.href ||
        (item.activeIfHrefStartsWith &&
          child.parentHref === item.activeIfHrefStartsWith),
    );
  }

  return menuItems;
};

const containerSx = {
  maxWidth: { lg: 1040 },
  margin: "0 auto",
  px: { xs: 4 },
};

const SettingsLayout = ({ children }: PropsWithChildren) => {
  const user = useAuthenticatedUser();

  const router = useRouter();

  const menuItems = useMemo(() => {
    if (!user.authenticatedUser.accountSignupComplete) {
      return [];
    }

    return generateMenuLinks(user.authenticatedUser.memberOf);
  }, [user.authenticatedUser]);

  const breadcrumbs = useMemo(() => {
    const crumbs = [];

    if (router.asPath !== "settings") {
      let href: string | undefined = router.asPath;

      do {
        const currentPage = menuItems.find(
          // eslint-disable-next-line no-loop-func
          (item) =>
            item.href === href ||
            (item.activeIfHrefStartsWith &&
              item.activeIfHrefStartsWith === href),
        );

        if (!currentPage) {
          break;
        }

        crumbs.unshift({
          id: currentPage.href,
          href: currentPage.href,
          title: currentPage.label,
        });

        href = currentPage.parentHref;
      } while (href);
    }

    crumbs.unshift({
      id: "settings",
      title: "Settings",
      href: "/settings",
    });

    return crumbs;
  }, [menuItems, router.asPath]);

  if (!user.authenticatedUser.accountSignupComplete) {
    void router.push("/login");
    return null;
  }

  return (
    <LayoutWithSidebar fullWidth>
      <TopContextBar
        crumbs={breadcrumbs}
        defaultCrumbIcon={null}
        scrollToTop={() => {}}
      />
      <Box sx={({ palette }) => ({ background: palette.common.white, py: 3 })}>
        <Typography variant="h4" sx={{ ...containerSx }}>
          Settings
        </Typography>
      </Box>
      <Container sx={{ ...containerSx, py: 6 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <SettingsSidebar menuItems={menuItems} />
          <Box sx={{ flex: 1 }}>{children}</Box>
        </Box>
      </Container>
    </LayoutWithSidebar>
  );
};

export const getSettingsLayout = (page: ReactElement) => {
  return <SettingsLayout>{page}</SettingsLayout>;
};
