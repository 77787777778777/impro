import { html, render } from "/js/lib/lit-html.js";
import { effect } from "/js/signals.js";
import { auth } from "/js/auth.js";
import { sidebarTemplate } from "/js/templates/sidebar.template.js";
import { footerTemplate } from "/js/templates/footer.template.js";
import { eyeIconTemplate } from "/js/templates/icons/eyeIcon.template.js";
import { PLUGIN_PREVIEW_QUERY_PARAM } from "/js/plugins/pluginService.js";

// Coarse "what kind of page is the user looking at" categories, for the
// overlay plugin slot's context-page attribute. There's no ready-made small
// enum for this in the router — derived here from the route-pattern string
// (router.js's $currentRoute.get().route) rather than touching every route
// registration in index.html.
const PAGE_KIND_ROUTES = {
  home: ["/", "/intent/compose"],
  notifications: ["/notifications"],
  chat: [
    "/messages",
    "/messages/inbox",
    "/messages/:convoId",
    "/messages/:convoId/settings",
  ],
  thread: [
    "/profile/:handleOrDid/post/:rkey",
    "/profile/:handleOrDid/post/:rkey/likes",
    "/profile/:handleOrDid/post/:rkey/quotes",
    "/profile/:handleOrDid/post/:rkey/reposts",
  ],
  profile: [
    "/profile/:handleOrDid",
    "/profile",
    "/profile/:handleOrDid/followers",
    "/profile/:handleOrDid/following",
    "/profile/:handleOrDid/known-followers",
    "/profile/:handleOrDid/lists/:rkey",
  ],
  settings: [
    "/settings",
    "/settings/appearance",
    "/settings/muted-words",
    "/settings/muted-accounts",
    "/settings/blocked-accounts",
    "/settings/advanced",
    "/settings/plugins",
    "/settings/plugins/:pluginId",
  ],
  discover: [
    "/search",
    "/feeds",
    "/bookmarks",
    "/hashtag/:tag",
    "/profile/:handleOrDid/feed/:rkey",
  ],
};

function derivePageKind(route) {
  for (const [kind, patterns] of Object.entries(PAGE_KIND_ROUTES)) {
    if (patterns.includes(route)) return kind;
  }
  return "other";
}

function exitPluginPreview() {
  const url = new URL(window.location.href);
  url.searchParams.delete(PLUGIN_PREVIEW_QUERY_PARAM);
  window.location.assign(url.toString());
}

function pluginPreviewBannerTemplate({ plugins }) {
  if (plugins.length === 0) return null;
  const links = [];
  plugins.forEach((plugin, index) => {
    if (index > 0) links.push(", ");
    links.push(
      html`<a
        class="plugin-preview-banner-link"
        href="/plugins/community/${encodeURIComponent(plugin.id)}"
        >${plugin.name}</a
      >`,
    );
  });
  return html`
    <div class="plugin-preview-banner" data-testid="plugin-preview-banner">
      <div class="plugin-preview-banner-icon">${eyeIconTemplate()}</div>
      <div class="plugin-preview-banner-body">
        <div class="plugin-preview-banner-title">Preview mode</div>
        <div class="plugin-preview-banner-subtitle">
          You are currently previewing community
          ${links.length === 1 ? "plugin" : "plugins"}: ${links}. Changes you
          make to the page won't be saved.
        </div>
      </div>
      <!-- <button
        class="plugin-preview-banner-exit"
        data-testid="plugin-preview-banner-exit"
        @click=${exitPluginPreview}
      >
        Exit preview
      </button> -->
    </div>
  `;
}
import { Layout } from "/js/router.js";
import "/js/components/animated-sidebar.js";
import "/js/components/plugin-slot.js";
import { OVERLAY_SLOT_NAME } from "/js/plugins/pluginService.js";
import "/js/context-provider.js";

export function mainLayoutTemplate({
  isAuthenticated = true,
  currentUser,
  activeNavItem,
  numNotifications = 0,
  numChatNotifications = 0,
  onClickActiveNavItem,
  children,
  onClickComposeButton,
  pluginService,
  previewingPlugins = [],
  onLongPressProfile = null,
  groupChatLinkService,
  pageKind = "other",
  profileActor = null,
  pluginComponentContext,
}) {
  return html`
    <context-provider
      context-id="plugin-component-context"
      .context=${pluginComponentContext}
      @chat-join-link:click=${(e) =>
        groupChatLinkService.handleAction(
          e.detail.actionType,
          e.detail.preview,
        )}
    >
      <div class="view-columns">
        <div class="view-column-left">
          ${sidebarTemplate({
            isAuthenticated,
            currentUser,
            activeNavItem,
            numNotifications,
            numChatNotifications,
            onClickActiveItem: onClickActiveNavItem,
            onClickComposeButton,
            pluginSidebarItems: pluginService.getSidebarItems(),
            onLongPressProfile,
          })}
        </div>
        <div class="view-column-center" data-testid="view-column-center">
          ${children}
        </div>
        <div class="view-column-right"></div>
      </div>
      <div class="plugin-overlay-container">
        <plugin-slot
          name=${OVERLAY_SLOT_NAME}
          context-page=${pageKind}
          context-notifications=${numNotifications ?? 0}
          context-profile-actor=${profileActor ?? ""}
          .pluginService=${pluginService}
        ></plugin-slot>
      </div>
      ${pluginPreviewBannerTemplate({ plugins: previewingPlugins })}
      ${footerTemplate({
        isAuthenticated,
        currentUser,
        activeNavItem,
        numNotifications,
        numChatNotifications,
        onClickActiveItem: onClickActiveNavItem,
        onLongPressProfile,
      })}
    </context-provider>
  `;
}

export class MainLayout extends Layout {
  #container = null;
  #disposeEffect = null;

  constructor(context, router) {
    super();
    this.context = context;
    this.router = router;
    const pagesEl = document.createElement("div");
    pagesEl.id = "pages";
    this.slot = pagesEl;
  }

  mount(container) {
    if (this.#container) {
      throw new Error("MainLayout is already mounted");
    }
    const {
      isAuthenticated,
      dataLayer,
      notificationService,
      chatNotificationService,
      postComposerService,
      accountSwitcherService,
      pluginService,
      groupChatLinkService,
      interactionHandlers,
    } = this.context;
    const pluginComponentContext = {
      isAuthenticated,
      dataLayer,
      pluginService,
      postInteractionHandler: interactionHandlers.postInteractionHandler,
    };
    const { router, slot } = this;

    container.id = "main-layout";
    this.#container = container;

    const onLongPressProfile =
      accountSwitcherService && auth.supportsMultipleAccounts()
        ? () => accountSwitcherService.openAccountSwitcherDialog()
        : null;

    // The active page may claim the click by cancelling the event
    const onClickActiveNavItem = () => {
      const event = new CustomEvent("active-nav-click", { cancelable: true });
      this.dispatchEvent(event);
      if (!event.defaultPrevented) {
        window.scrollTo({ top: -1, behavior: "smooth" });
      }
    };

    this.#disposeEffect = effect(() => {
      const currentRoute = router.$currentRoute.get();
      const layoutOptions = currentRoute?.options?.layoutOptions ?? {};
      const currentUser = dataLayer.derived.$currentUser.get();
      const activeNavItem =
        typeof layoutOptions.activeNavItem === "function"
          ? layoutOptions.activeNavItem(currentRoute.params)
          : (layoutOptions.activeNavItem ?? null);
      const pageKind = derivePageKind(currentRoute?.route ?? null);
      // Only meaningful on the profile page kind — the handle or DID of
      // whichever profile is being viewed, straight from the route param
      // (app.bsky's getProfile-family endpoints already accept either
      // interchangeably, so no extra resolution step is needed here).
      const profileActor =
        pageKind === "profile"
          ? (currentRoute?.params?.handleOrDid ?? null)
          : null;
      const previewingPlugins = pluginService.isPreviewMode
        ? pluginService.$pluginsInfo.get().filter((plugin) => plugin.loaded)
        : [];
      render(
        mainLayoutTemplate({
          isAuthenticated,
          currentUser,
          activeNavItem,
          numNotifications:
            notificationService?.$numNotifications.get() ?? null,
          numChatNotifications:
            chatNotificationService?.$numNotifications.get() ?? null,
          onClickActiveNavItem,
          children: slot,
          onClickComposeButton: () =>
            postComposerService.composePost({ currentUser }),
          pluginService,
          previewingPlugins,
          onLongPressProfile,
          groupChatLinkService,
          pageKind,
          profileActor,
          pluginComponentContext,
        }),
        container,
      );
    });
  }

  openSidebar() {
    this.#container?.querySelector("animated-sidebar")?.open();
  }

  dispose() {
    this.#disposeEffect?.();
    this.#disposeEffect = null;
    this.#container?.replaceChildren();
    this.#container = null;
  }
}
