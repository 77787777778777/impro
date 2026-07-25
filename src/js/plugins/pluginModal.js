import { html } from "/js/lib/lit-html.js";
import { confirmModal } from "/js/modals/confirm.modal.js";
import { closeWithAnimation } from "/js/dialogHelpers.js";

const pluginModals = new Map();

export function showPluginModal({
  pluginRenderer,
  pluginId,
  modalId,
  title,
  content,
  onDismiss = () => {},
}) {
  let modal = pluginModals.get(`${pluginId}:${modalId}`);
  if (modal?.isOpen) return;
  if (modal?.isDismissing) {
    modal.nextOpen = {
      pluginRenderer,
      pluginId,
      modalId,
      title,
      content,
      onDismiss,
    };
    return;
  }

  if (!modal) {
    const dialog = document.createElement("dialog");
    dialog.classList.add("modal-dialog", "plugin-modal");
    dialog.dataset.pluginId = pluginId;

    const contentEl = document.createElement("div");
    contentEl.classList.add("modal-dialog-content");
    dialog.appendChild(contentEl);

    modal = {
      dialog,
      contentEl,
      isOpen: false,
      isDismissing: false,
      nextOpen: null,
    };
    let userDismissed = false;
    // Teardown runs on every close — including the router closing it on
    // navigation, which bypasses the dismiss() wrapper below. This dialog is
    // created once and reused across opens, so the listener stays attached.
    dialog.addEventListener("close", () => {
      modal.isOpen = false;
      modal.isDismissing = false;
      if (userDismissed) {
        userDismissed = false;
        modal.onDismiss();
      }
      const nextOpen = modal.nextOpen;
      modal.nextOpen = null;
      if (nextOpen) showPluginModal(nextOpen);
    });
    modal.dismiss = () => closeWithAnimation(dialog);

    function dismiss() {
      if (!modal.isOpen) return;
      userDismissed = true;
      modal.isDismissing = true;
      return modal.dismiss();
    }

    dialog.addEventListener("click", (event) => {
      if (event.target.tagName === "DIALOG") dismiss();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dismiss();
    });

    pluginModals.set(`${pluginId}:${modalId}`, modal);
    document.body.appendChild(dialog);
  }

  modal.onDismiss = onDismiss;
  modal.contentEl.replaceChildren();
  if (!pluginRenderer.isEmptyNode(title)) {
    const titleEl = pluginRenderer.createRoot().render(title);
    if (titleEl.nodeType === Node.ELEMENT_NODE) {
      titleEl.classList.add("modal-dialog-title");
    }
    modal.contentEl.appendChild(titleEl);
  }
  if (content?.children?.length) {
    for (const childNode of content.children) {
      modal.contentEl.appendChild(
        pluginRenderer.createRoot().render(childNode),
      );
    }
  } else if (!pluginRenderer.isEmptyNode(content)) {
    modal.contentEl.appendChild(pluginRenderer.createRoot().render(content));
  }
  modal.isOpen = true;
  modal.dialog.showModal();
}

export function hidePluginModal({ pluginId, modalId }) {
  const modal = pluginModals.get(`${pluginId}:${modalId}`);
  if (modal && modal.isOpen) {
    modal.isDismissing = true;
    modal.dismiss();
  }
}

const ACTION_LABELS = {
  mute: "Mute and unmute accounts on your behalf",
  block: "Block and unblock accounts on your behalf",
  feedFeedback:
    'Send feed feedback (e.g. "show fewer/more like this") on your behalf',
  like: "Like and unlike posts on your behalf",
  repost: "Repost and un-repost posts on your behalf",
  follow: "Follow and unfollow accounts on your behalf",
  bookmark: "Save and remove bookmarked posts on your behalf",
};

const UI_LABELS = {
  overlay: "Show a persistent overlay on top of every screen",
};

const NETWORK_LABELS = {
  configuredEndpoint:
    "Send requests to an address you configure and approve in its settings",
};

const IMAGE_LABELS = {
  upload: "Store custom images you upload in its settings",
};

const CLIPBOARD_LABELS = {
  write: "Copy text it generates to your clipboard",
};

function permissionsListTemplate({ permissions }) {
  const sections = [];
  const fetchPatterns = permissions.fetch ?? [];
  if (fetchPatterns.length > 0) {
    sections.push(html`
      <div class="permission-prompt-section">
        <div>Send network requests to:</div>
        <ul class="permission-prompt-list">
          ${fetchPatterns.map(
            (pattern) => html`<li><code>${pattern}</code></li>`,
          )}
        </ul>
      </div>
    `);
  }
  const actionScopes = permissions.actions ?? [];
  if (actionScopes.length > 0) {
    sections.push(html`
      <div class="permission-prompt-section">
        <ul class="permission-prompt-list">
          ${actionScopes.map(
            (scope) => html`<li>${ACTION_LABELS[scope] ?? scope}</li>`,
          )}
        </ul>
      </div>
    `);
  }
  const uiScopes = permissions.ui ?? [];
  if (uiScopes.length > 0) {
    sections.push(html`
      <div class="permission-prompt-section">
        <ul class="permission-prompt-list">
          ${uiScopes.map(
            (scope) => html`<li>${UI_LABELS[scope] ?? scope}</li>`,
          )}
        </ul>
      </div>
    `);
  }
  const networkScopes = permissions.network ?? [];
  if (networkScopes.length > 0) {
    sections.push(html`
      <div class="permission-prompt-section">
        <ul class="permission-prompt-list">
          ${networkScopes.map(
            (scope) => html`<li>${NETWORK_LABELS[scope] ?? scope}</li>`,
          )}
        </ul>
      </div>
    `);
  }
  const imageScopes = permissions.images ?? [];
  if (imageScopes.length > 0) {
    sections.push(html`
      <div class="permission-prompt-section">
        <ul class="permission-prompt-list">
          ${imageScopes.map(
            (scope) => html`<li>${IMAGE_LABELS[scope] ?? scope}</li>`,
          )}
        </ul>
      </div>
    `);
  }
  const clipboardScopes = permissions.clipboard ?? [];
  if (clipboardScopes.length > 0) {
    sections.push(html`
      <div class="permission-prompt-section">
        <ul class="permission-prompt-list">
          ${clipboardScopes.map(
            (scope) => html`<li>${CLIPBOARD_LABELS[scope] ?? scope}</li>`,
          )}
        </ul>
      </div>
    `);
  }
  return sections;
}

export async function showPluginInstallPermissionsModal({
  pluginName,
  permissions,
}) {
  const name = pluginName ?? "This plugin";
  return confirmModal(
    html`<span data-testid="permission-prompt">
      <span>${name} wants permission to:</span>
      ${permissionsListTemplate({ permissions })}
    </span>`,
    {
      title: "Grant permissions?",
      confirmButtonText: "Allow and install",
    },
  );
}

// Host-native (not plugin-rendered) confirmation that a plugin may send
// requests to exactly this URL, going forward, until the user approves a
// different one. Rendering this with a plain string (not plugin-supplied
// VirtualEl content) is the whole point — a plugin must never be able to
// spoof the address the user is being asked to approve.
export async function showConfiguredEndpointModal({ pluginName, url }) {
  const name = pluginName ?? "This plugin";
  return confirmModal(
    html`<span data-testid="configured-endpoint-prompt">
      <span
        >${name} wants to send requests to the following address, and only this
        address, until you approve a different one:</span
      >
      <p><code data-testid="configured-endpoint-url">${url}</code></p>
    </span>`,
    {
      title: "Allow this address?",
      confirmButtonText: "Allow",
    },
  );
}

export async function showPluginUpdatePermissionsModal({
  pluginName,
  pluginVersion,
  permissionsDiff,
}) {
  const name = pluginName ?? "This plugin";
  const heading = pluginVersion
    ? `${name} v${pluginVersion} requests new permissions:`
    : `${name} requests new permissions:`;
  return confirmModal(
    html`<span data-testid="permission-update-prompt">
      <span>${heading}</span>
      ${permissionsListTemplate({ permissions: permissionsDiff })}
    </span>`,
    {
      title: "Grant new permissions?",
      confirmButtonText: "Allow and update",
    },
  );
}
