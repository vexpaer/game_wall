import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

let refreshTimer: gsap.core.Tween | undefined;
let libraryTween: gsap.core.Tween | undefined;

export const refreshDashboardLayout = () => {
  refreshTimer?.kill();
  refreshTimer = gsap.delayedCall(0.16, () => ScrollTrigger.refresh());
};

export const animateLibraryUpdate = (cards: HTMLElement[], onComplete?: () => void) => {
  const visibleCards = cards.filter((card) => !card.hidden);
  libraryTween?.kill();

  if (visibleCards.length === 0) {
    refreshDashboardLayout();
    onComplete?.();
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.set(visibleCards, { clearProps: "opacity,visibility,transform" });
    refreshDashboardLayout();
    onComplete?.();
    return;
  }

  libraryTween = gsap.fromTo(
    visibleCards,
    { autoAlpha: 0, y: 24, scale: 0.96 },
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.5,
      stagger: { amount: Math.min(0.38, visibleCards.length * 0.035), from: "start" },
      ease: "back.out(1.25)",
      overwrite: true,
      clearProps: "opacity,visibility,transform",
      onComplete: () => {
        refreshDashboardLayout();
        onComplete?.();
      }
    }
  );
};

const createTilt = (target: HTMLElement, strength = 7) => {
  const image = target.querySelector<HTMLElement>(".game-card__art img:not(.game-card__icon)");
  const rotateX = gsap.quickTo(target, "rotationX", { duration: 0.42, ease: "power3.out" });
  const rotateY = gsap.quickTo(target, "rotationY", { duration: 0.42, ease: "power3.out" });
  const lift = gsap.quickTo(target, "y", { duration: 0.38, ease: "power3.out" });
  const imageX = image ? gsap.quickTo(image, "x", { duration: 0.55, ease: "power3.out" }) : undefined;
  const imageY = image ? gsap.quickTo(image, "y", { duration: 0.55, ease: "power3.out" }) : undefined;

  gsap.set(target, { transformPerspective: 900, transformOrigin: "center center", willChange: "transform" });
  if (image) gsap.set(image, { willChange: "transform" });

  const move = (event: PointerEvent) => {
    const bounds = target.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    rotateX(y * -strength);
    rotateY(x * strength);
    lift(-6);
    imageX?.(x * -9);
    imageY?.(y * -7);
  };

  const reset = () => {
    rotateX(0);
    rotateY(0);
    lift(0);
    imageX?.(0);
    imageY?.(0);
  };

  target.addEventListener("pointermove", move);
  target.addEventListener("pointerleave", reset);
  return () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerleave", reset);
    gsap.killTweensOf([target, image].filter(Boolean));
    gsap.set(target, { clearProps: "willChange" });
    if (image) gsap.set(image, { clearProps: "willChange" });
  };
};

export const initDashboardEffects = () => {
  const dashboard = document.querySelector<HTMLElement>(".dashboard");
  if (!dashboard || dashboard.dataset.motionReady === "true") return;

  if (document.documentElement.dataset.bootState !== "complete") {
    if (dashboard.dataset.motionQueued === "true") return;
    dashboard.dataset.motionQueued = "true";
    window.addEventListener("game-wall:boot-complete", () => initDashboardEffects(), { once: true });
    return;
  }

  delete dashboard.dataset.motionQueued;
  dashboard.dataset.motionReady = "true";

  const profileAvatar = dashboard.querySelector<HTMLImageElement>("[data-profile-avatar]");
  if (profileAvatar) {
    const hideBrokenAvatar = () => { profileAvatar.hidden = true; };
    if (profileAvatar.complete && profileAvatar.naturalWidth === 0) hideBrokenAvatar();
    else profileAvatar.addEventListener("error", hideBrokenAvatar, { once: true });
  }

  const media = gsap.matchMedia();

  media.add(
    {
      desktop: "(min-width: 941px)",
      mobile: "(max-width: 940px)",
      animate: "(prefers-reduced-motion: no-preference)",
      finePointer: "(hover: hover) and (pointer: fine)"
    },
    (context) => {
      const { desktop, animate, finePointer } = context.conditions as {
        desktop: boolean;
        mobile: boolean;
        animate: boolean;
        finePointer: boolean;
      };

      const hero = dashboard.querySelector<HTMLElement>(".dashboard-hero");
      const heroCopy = dashboard.querySelector<HTMLElement>(".dashboard-hero__copy");
      const heroVisual = dashboard.querySelector<HTMLElement>(".dashboard-hero__visual");
      const profileCard = dashboard.querySelector<HTMLElement>(".profile-card");
      const orbit = dashboard.querySelector<HTMLElement>(".hero-orbit");
      const stackCards = gsap.utils.toArray<HTMLElement>(".hero-game-stack__card", dashboard);
      const titleLines = gsap.utils.toArray<HTMLElement>(".hero-title-line", dashboard);
      const metricCards = gsap.utils.toArray<HTMLElement>(".metric-card", dashboard);
      const gameCards = gsap.utils.toArray<HTMLElement>("[data-game-card]", dashboard);
      const interactiveGameCards = gameCards.filter(
        (card) => card.closest(".recent-grid") !== null || card.closest("#library-grid") !== null
      );

      if (!animate) {
        gsap.set(
          [hero, heroCopy, heroVisual, profileCard, orbit, ...stackCards, ...titleLines, ...metricCards, ...gameCards].filter(Boolean),
          { clearProps: "all" }
        );
        return;
      }

      const intro = gsap.timeline({ defaults: { ease: "power4.out" } });
      intro
        .from(".dashboard-hero__beam", { scaleX: 0, duration: 1.05, stagger: 0.12, transformOrigin: "left center" })
        .from(".dashboard-hero__eyebrow", { autoAlpha: 0, x: -22, duration: 0.5 }, 0.12)
        .from(titleLines, { yPercent: 118, rotation: 3, autoAlpha: 0, duration: 0.82, stagger: 0.075 }, 0.16)
        .from(".dashboard-hero__lead", { autoAlpha: 0, y: 24, duration: 0.55 }, 0.5)
        .from(".dashboard-hero__meta span", { autoAlpha: 0, y: 16, scale: 0.92, duration: 0.42, stagger: 0.08 }, 0.62)
        .from(profileCard, { autoAlpha: 0, x: desktop ? 76 : 0, y: desktop ? 0 : 45, rotationY: desktop ? -13 : 0, scale: 0.88, duration: 0.92 }, 0.28)
        .from(orbit, { autoAlpha: 0, scale: 0.5, rotation: -90, duration: 1.15 }, 0.32)
        .from(stackCards, { autoAlpha: 0, scale: 0.7, rotation: (index) => (index - 1) * 12, duration: 0.7, stagger: 0.09 }, 0.46);

      const heroLoops: gsap.core.Tween[] = [];
      const introDelay = intro.duration();
      if (orbit) {
        heroLoops.push(gsap.to(orbit, { rotation: 360, duration: 24, delay: introDelay, repeat: -1, ease: "none" }));
      }

      const scanline = dashboard.querySelector<HTMLElement>(".profile-card__scanline");
      if (scanline) {
        heroLoops.push(gsap.fromTo(scanline, { yPercent: -110 }, { yPercent: 110, duration: 2.8, delay: introDelay, repeat: -1, ease: "none" }));
      }

      stackCards.forEach((card, index) => {
        heroLoops.push(gsap.to(card, {
          y: index % 2 ? 10 : -9,
          rotation: `${index % 2 ? "+=" : "-="}${3 + index}`,
          duration: 3.2 + index * 0.7,
          delay: introDelay + index * 0.08,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut"
        }));
      });

      if (hero && heroLoops.length > 0) {
        ScrollTrigger.create({
          trigger: hero,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => heroLoops.forEach((loop) => loop.paused(!self.isActive))
        });
      }

      if (heroCopy && hero) {
        gsap.to(heroCopy, {
          y: desktop ? -62 : -28,
          ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 1 }
        });
      }

      if (heroVisual && hero) {
        gsap.to(heroVisual, {
          y: desktop ? 52 : 20,
          rotation: desktop ? 1.8 : 0,
          ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 1.1 }
        });
      }

      const metricsTimeline = gsap.timeline({
        scrollTrigger: { trigger: ".metrics", start: "top 86%", once: true }
      });
      metricsTimeline.from(metricCards, {
        autoAlpha: 0,
        y: 68,
        rotation: (index) => (index % 2 ? 2.5 : -2.5),
        scale: 0.9,
        duration: 0.72,
        stagger: 0.085,
        ease: "back.out(1.35)"
      });

      const manifesto = dashboard.querySelector<HTMLElement>(".manifesto");
      const manifestoTrack = dashboard.querySelector<HTMLElement>(".manifesto__track");
      if (manifesto && manifestoTrack) {
        gsap.fromTo(
          manifestoTrack,
          { xPercent: desktop ? 8 : 2 },
          {
            xPercent: desktop ? -18 : -34,
            ease: "none",
            scrollTrigger: { trigger: manifesto, start: "top bottom", end: "bottom top", scrub: 1 }
          }
        );
        gsap.from(".manifesto__note", {
          autoAlpha: 0,
          y: 28,
          duration: 0.65,
          scrollTrigger: { trigger: manifesto, start: "top 72%", once: true }
        });
      }

      gsap.utils.toArray<HTMLElement>(".page-section", dashboard).forEach((section) => {
        const heading = section.querySelector<HTMLElement>(".section-heading");
        if (!heading) return;
        gsap.from(heading.children, {
          autoAlpha: 0,
          y: 32,
          duration: 0.66,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: { trigger: heading, start: "top 86%", once: true }
        });
      });

      ScrollTrigger.batch(".recent-grid [data-game-card]", {
        start: "top 88%",
        once: true,
        interval: 0.08,
        batchMax: 4,
        onEnter: (batch) => gsap.from(batch, {
          autoAlpha: 0,
          y: 54,
          rotationY: 8,
          scale: 0.92,
          duration: 0.68,
          stagger: 0.09,
          ease: "back.out(1.25)",
          overwrite: true
        })
      });

      const insightsGrid = dashboard.querySelector<HTMLElement>(".insights-grid");
      if (insightsGrid) {
        gsap.from(insightsGrid.querySelectorAll(".insight-panel"), {
          autoAlpha: 0,
          y: 54,
          rotationX: 5,
          duration: 0.78,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: insightsGrid, start: "top 82%", once: true }
        });
      }

      const rankingList = dashboard.querySelector<HTMLElement>(".ranking-list");
      if (rankingList) {
        gsap.from(rankingList.querySelectorAll(".ranking-list__track span"), {
          scaleX: 0,
          transformOrigin: "left center",
          duration: 0.82,
          stagger: 0.09,
          ease: "power3.out",
          scrollTrigger: { trigger: rankingList, start: "top 82%", once: true }
        });
      }

      const achievementChart = dashboard.querySelector<HTMLElement>(".achievement-chart");
      if (achievementChart) {
        gsap.from(achievementChart.querySelectorAll(".achievement-chart__segment"), {
          strokeDashoffset: 100,
          duration: 1.05,
          stagger: 0.11,
          ease: "power2.inOut",
          scrollTrigger: { trigger: achievementChart, start: "top 82%", once: true }
        });
      }

      gsap.from(".filter-panel, .library-view-settings", {
        autoAlpha: 0,
        y: 32,
        scale: 0.985,
        duration: 0.62,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: ".filter-panel", start: "top 88%", once: true }
      });

      const initialLibraryCards = gameCards.filter((card) => card.closest("#library-grid") && !card.hidden);
      ScrollTrigger.batch(initialLibraryCards, {
        start: "top 92%",
        once: true,
        interval: 0.08,
        batchMax: () => desktop ? 6 : 3,
        onEnter: (batch) => gsap.from(batch, {
          autoAlpha: 0,
          y: 42,
          scale: 0.94,
          duration: 0.58,
          stagger: 0.06,
          ease: "power3.out",
          overwrite: true
        })
      });

      ScrollTrigger.batch(".game-card__achievement .achievement__track span", {
        start: "top 94%",
        once: true,
        interval: 0.07,
        batchMax: 8,
        onEnter: (batch) => gsap.from(batch, {
          scaleX: 0,
          transformOrigin: "left center",
          duration: 0.7,
          stagger: 0.045,
          ease: "power3.out",
          overwrite: true
        })
      });

      const cleanups: Array<() => void> = [];
      if (finePointer) {
        interactiveGameCards.forEach((card) => cleanups.push(createTilt(card, 6.5)));
      }

      refreshDashboardLayout();
      return () => cleanups.forEach((cleanup) => cleanup());
    }
  );
};
