import { LightningElement } from "lwc";
import { OmniscriptBaseMixin } from "omnistudio/omniscriptBaseMixin";

const PING_EVENT   = "omniscript-bridge-ping";
const PONG_EVENT   = "omniscript-bridge-pong";
const RESTORE_EVENT = "omniscript-state-update";
const RESULT_EVENT  = "omniscript-state-update-result";

export default class OmniScriptStateBridge extends OmniscriptBaseMixin(LightningElement) {
  connectedCallback() {
    window.addEventListener(PING_EVENT, this.handlePing);
    window.addEventListener(RESTORE_EVENT, this.handleRestore);
  }

  disconnectedCallback() {
    window.removeEventListener(PING_EVENT, this.handlePing);
    window.removeEventListener(RESTORE_EVENT, this.handleRestore);
  }

  // Reply synchronously so a caller can detect us within the same dispatch.
  handlePing = () => {
	if (typeof this.omniApplyCallResp !== "function") {
		console.log('No OmniScript detected');
      return; // don't reply → caller reports "not detected"
    }

    window.dispatchEvent(
      new CustomEvent(PONG_EVENT, {
        detail: JSON.stringify({ present: true })
      })
    );
  };

  handleRestore = (event) => {
	try {
      const raw = event.detail;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      // omniApplyCallResp cannot accept proxy objects.
      const safeData = JSON.parse(JSON.stringify(data));

	  // true => send via pubsub, asynchronously.
      this.omniApplyCallResp(safeData, true);

	  window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: JSON.stringify({ ok: true })
        })
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("omniScriptStateBridge: restore failed", e);

      window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: JSON.stringify({ ok: false, error: e.message })
        })
      );
    }
  };
}