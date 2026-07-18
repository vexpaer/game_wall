import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const cleanupCallbacks: Array<() => void> = [];

const listen = <K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions
) => {
  target.addEventListener(type, listener, options);
  cleanupCallbacks.push(() => target.removeEventListener(type, listener, options));
};

const initSiteEffects = () => {
  cleanupCallbacks.splice(0).forEach((cleanup) => cleanup());
  ScrollTrigger.getById("page-progress")?.kill();

  const boot = document.querySelector<HTMLElement>(".boot-screen");
  const siteShell = document.querySelector<HTMLElement>(".site-shell");
  const header = document.querySelector<HTMLElement>(".site-header");
  const signalTrack = document.querySelector<HTMLElement>(".signal-strip__track");
  const cursor = document.querySelector<HTMLElement>(".cursor-aura");
  const progress = document.querySelector<HTMLElement>(".scroll-progress span");
  const ambientOrbs = gsap.utils.toArray<HTMLElement>(".ambient-orb");
  const media = gsap.matchMedia();

  if (progress) {
    gsap.set(progress, { scaleX: 0, transformOrigin: "left center" });
    const setProgress = gsap.quickSetter(progress, "scaleX");
    ScrollTrigger.create({
      id: "page-progress",
      start: 0,
      end: "max",
      onUpdate: (self) => setProgress(self.progress)
    });
  }

  media.add(
    {
      animate: "(prefers-reduced-motion: no-preference)",
      finePointer: "(hover: hover) and (pointer: fine)"
    },
    (context) => {
      const { animate, finePointer } = context.conditions as { animate: boolean; finePointer: boolean };
      const mediaCleanups: Array<() => void> = [];
      const completeBoot = () => {
        if (siteShell) siteShell.inert = false;
        document.documentElement.dataset.bootState = "complete";
        window.dispatchEvent(new CustomEvent("game-wall:boot-complete"));
      };
      const revealHeader = () => {
        completeBoot();
        if (header) {
          gsap.from(header, { y: -36, autoAlpha: 0, duration: 0.9, ease: "power4.out" });
        }
      };

      if (!animate) {
        if (boot) boot.hidden = true;
        gsap.set([header, signalTrack, cursor, ...ambientOrbs].filter(Boolean), { clearProps: "all" });
        completeBoot();
        return;
      }

      let hasBooted = false;
      try {
        hasBooted = sessionStorage.getItem("game-wall:booted") === "true";
      } catch {
        // Session storage can be unavailable in strict privacy modes.
      }

      if (boot && !hasBooted) {
        if (siteShell) siteShell.inert = true;
        boot.hidden = false;
        const bootTimeline = gsap.timeline({
          defaults: { ease: "power3.out" },
          onComplete: () => {
            boot.hidden = true;
            try {
              sessionStorage.setItem("game-wall:booted", "true");
            } catch {
              // The visual boot sequence remains optional when storage is blocked.
            }
            revealHeader();
          }
        });
        bootTimeline
          .set(boot, { autoAlpha: 1 })
          .from(".boot-screen__brand span", { yPercent: 115, rotation: 7, duration: 0.62, stagger: 0.07 })
          .from(".boot-screen__code, .boot-screen__status", { autoAlpha: 0, y: 12, duration: 0.35, stagger: 0.08 }, 0.12)
          .fromTo(".boot-screen__bar i", { scaleX: 0 }, { scaleX: 1, duration: 0.72, ease: "expo.inOut" }, 0.08)
          .to(boot, { yPercent: -105, duration: 0.78, ease: "power4.inOut" }, 0.82);
      } else if (boot) {
        boot.hidden = true;
        revealHeader();
      } else {
        revealHeader();
      }

      if (signalTrack) {
        const ticker = gsap.to(signalTrack, { xPercent: -50, duration: 22, repeat: -1, ease: "none" });
        ScrollTrigger.create({
          trigger: ".signal-strip",
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => ticker.paused(!self.isActive)
        });
      }

      ambientOrbs.forEach((orb, index) => {
        gsap.to(orb, {
          xPercent: index === 1 ? -18 : 14,
          yPercent: index === 2 ? -22 : 16,
          rotation: index % 2 ? -180 : 180,
          scale: index === 1 ? 1.18 : 1.28,
          duration: 12 + index * 3,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut"
        });
      });

      if (finePointer && cursor) {
        const moveX = gsap.quickTo(cursor, "x", { duration: 0.42, ease: "power3.out" });
        const moveY = gsap.quickTo(cursor, "y", { duration: 0.42, ease: "power3.out" });
        let cursorVisible = false;
        const moveCursor = (event: PointerEvent) => {
          if (!cursorVisible) {
            cursorVisible = true;
            gsap.set(cursor, { autoAlpha: 1 });
          }
          moveX(event.clientX);
          moveY(event.clientY);
        };
        window.addEventListener("pointermove", moveCursor, { passive: true });
        mediaCleanups.push(() => window.removeEventListener("pointermove", moveCursor));

        const interactiveElements = gsap.utils.toArray<HTMLElement>("a, button, input, select, [data-magnetic]");
        interactiveElements.forEach((element) => {
          const enter = () => gsap.to(cursor, { scale: 1.75, duration: 0.28, overwrite: true });
          const leave = () => gsap.to(cursor, { scale: 1, duration: 0.32, overwrite: true });
          element.addEventListener("pointerenter", enter);
          element.addEventListener("pointerleave", leave);
          mediaCleanups.push(() => {
            element.removeEventListener("pointerenter", enter);
            element.removeEventListener("pointerleave", leave);
          });
        });
      }

      return () => mediaCleanups.forEach((cleanup) => cleanup());
    }
  );

  const refresh = () => ScrollTrigger.refresh();
  if (document.fonts?.ready) document.fonts.ready.then(refresh);
  listen(window, "load", refresh, { once: true });

  cleanupCallbacks.push(() => media.revert());
};

initSiteEffects();
