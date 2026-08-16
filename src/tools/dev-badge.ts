export function setupDevBadge(): void {
  if (process.env.NODE_ENV !== "development") return;

  const toast = document.createElement("div");
  toast.className = "VL-DevToast";

  const style = document.createElement("style");
  style.textContent = `
    .VL-DevToast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%) translateY(12px);
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 28px;
      border-radius: 10px;
      background: rgba(40, 40, 40, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      opacity: 0;
      pointer-events: none;
      animation: VL-ToastIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards,
                 VL-ToastOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) 3.8s forwards;
    }

    .VL-DevToastDot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #1db954;
      box-shadow: 0 0 10px rgba(29, 185, 84, 0.5);
      animation: VL-DevPulse 1.5s ease-in-out infinite;
    }

    .VL-DevToastText {
      white-space: nowrap;
    }

    @keyframes VL-ToastIn {
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes VL-ToastOut {
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(12px);
      }
    }

    @keyframes VL-DevPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }
  `;

  toast.innerHTML = `
    <span class="VL-DevToastDot"></span>
    <span class="VL-DevToastText">Vivid Lyrics — Dev Mode</span>
  `;

  document.head.appendChild(style);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
    style.remove();
  }, 4500);
}
