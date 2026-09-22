const hero = document.querySelector<HTMLElement>(".hero");
const pointerMedia = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
let disposePointer: (() => void) | undefined;

function mountPointer(heroElement: HTMLElement) {
  const cursor = document.createElement("div");
  cursor.className = "paw-cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML = '<svg viewBox="0 0 40 40" focusable="false"><g fill="currentColor"><ellipse cx="8" cy="17" rx="4.2" ry="5.6" transform="rotate(-28 8 17)"/><ellipse cx="15.5" cy="9.5" rx="4.2" ry="5.7" transform="rotate(-10 15.5 9.5)"/><ellipse cx="25" cy="9.5" rx="4.2" ry="5.7" transform="rotate(10 25 9.5)"/><ellipse cx="32.5" cy="17" rx="4.2" ry="5.6" transform="rotate(28 32.5 17)"/><path d="M20 19c-4.3 0-5.2 4.2-8.5 7.2C6.8 30.5 9 36 14.2 36c2.4 0 3.7-1.3 5.8-1.3s3.4 1.3 5.8 1.3c5.2 0 7.4-5.5 2.7-9.8C25.2 23.2 24.3 19 20 19Z"/></g></svg>';
  document.body.append(cursor);
  document.documentElement.classList.add("paw-cursor-active");

  const controller = new AbortController();
  const options = { passive: true, signal: controller.signal };
  let frame: number | undefined;
  let pointerX = 0;
  let pointerY = 0;

  function hidePointer() {
    cursor.classList.remove("is-visible", "is-pressed");
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }

  function canShowPointer(event: PointerEvent) {
    return event.pointerType === "mouse"
      && event.clientY >= heroElement.getBoundingClientRect().bottom
      && event.target instanceof Element;
  }

  function movePointer(event: PointerEvent) {
    if (!canShowPointer(event)) {
      hidePointer();
      return;
    }
    pointerX = Math.min(event.clientX + 18, window.innerWidth - 38);
    pointerY = Math.min(event.clientY + 18, window.innerHeight - 38);
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      cursor.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0)`;
      cursor.classList.add("is-visible");
      frame = undefined;
    });
  }

  document.addEventListener("pointermove", movePointer, options);
  document.addEventListener("pointerdown", (event) => {
    cursor.classList.toggle("is-pressed", canShowPointer(event));
  }, options);
  document.addEventListener("pointerup", () => cursor.classList.remove("is-pressed"), options);
  document.addEventListener("pointercancel", hidePointer, options);
  document.documentElement.addEventListener("pointerleave", hidePointer, options);
  document.addEventListener("scroll", hidePointer, { ...options, capture: true });
  document.addEventListener("visibilitychange", hidePointer, options);
  document.addEventListener("keydown", hidePointer, options);
  window.addEventListener("blur", hidePointer, options);
  window.addEventListener("resize", hidePointer, options);

  return () => {
    controller.abort();
    hidePointer();
    cursor.remove();
    document.documentElement.classList.remove("paw-cursor-active");
  };
}

function syncPointer() {
  disposePointer?.();
  disposePointer = hero && pointerMedia.matches ? mountPointer(hero) : undefined;
}

pointerMedia.addEventListener("change", syncPointer);
syncPointer();
