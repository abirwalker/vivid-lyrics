import { get, onSettingsChange } from "../stores/settings";
import "../styles/fluid-mesh-bg.scss";

/*
 * Creates a fluid animated mesh background container.
 */
export function createFluidMeshBackground(): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "VL-FluidMeshBg";
  container.setAttribute("aria-hidden", "true");

  const flowContainer = document.createElement("div");
  flowContainer.className = "VL-MeshFlowContainer";

  for (let i = 1; i <= 5; i++) {
    const flow = document.createElement("div");
    flow.className = `VL-MeshFlow VL-MeshFlow-${i}`;
    flowContainer.appendChild(flow);
  }

  const backdrop = document.createElement("div");
  backdrop.className = "VL-MeshBackdrop";

  container.appendChild(flowContainer);
  container.appendChild(backdrop);

  function syncMode(): void {
    const mode = get("backgroundMode");
    container.classList.remove("VL-BgMode-none", "VL-BgMode-static", "VL-BgMode-dynamic");
    if (mode === "none") {
      container.classList.add("VL-BgMode-none");
    } else if (mode === "static") {
      container.classList.add("VL-BgMode-static");
    } else {
      container.classList.add("VL-BgMode-dynamic");
    }
  }

  onSettingsChange(({ key }) => {
    if (key === "backgroundMode" || key === null) {
      syncMode();
    }
  });

  syncMode();
  return container;
}
