import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const initDetailEffects = () => {
const root = document.querySelector<HTMLElement>("[data-detail-page]");

if (root) {
  const select = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const selectAll = <T extends Element = HTMLElement>(selector: string) => Array.from(root.querySelectorAll<T>(selector));
  const hero = select<HTMLElement>("[data-detail-hero]");
  const matchMedia = gsap.matchMedia();

  matchMedia.add(
    {
      isWide: "(min-width: 801px)",
      isNarrow: "(max-width: 800px)",
      reduceMotion: "(prefers-reduced-motion: reduce)"
    },
    (context) => {
      const conditions = context.conditions as {
        isWide: boolean;
        isNarrow: boolean;
        reduceMotion: boolean;
      };
      const { isWide, reduceMotion } = conditions;

      root.classList.toggle("is-motion-reduced", reduceMotion);
      if (reduceMotion || !hero) {
        return () => root.classList.remove("is-motion-reduced");
      }

      root.classList.add("is-gsap-ready");
      const cleanups: Array<() => void> = [];
      const backdrop = select<HTMLElement>(".detail-hero__backdrop");
      const heroGrid = select<HTMLElement>(".detail-hero__grid");
      const heroCursor = select<HTMLElement>(".detail-hero__cursor");
      const heroFlare = select<HTMLElement>(".detail-hero__flare");
      const heroScan = select<HTMLElement>(".detail-hero__scan");
      const heroCover = select<HTMLElement>("[data-hero-cover]");
      const heroCopy = select<HTMLElement>(".detail-hero__copy");
      const heroKicker = select<HTMLElement>(".detail-hero__copy .section-kicker");
      const heroTitle = select<HTMLElement>("[data-hero-title]");
      const titleEcho = select<HTMLElement>(".detail-title__echo");
      const backLink = select<HTMLElement>(".detail-back");
      const heroHud = select<HTMLElement>(".detail-hero__hud");
      const heroTags = selectAll<HTMLElement>("[data-hero-tag]");
      const heroButtons = selectAll<HTMLElement>("[data-magnetic]");

      const intro = gsap.timeline({
        defaults: { duration: 0.72, ease: "power3.out" },
        onComplete: () => ScrollTrigger.refresh()
      });

      intro.addLabel("frame", 0).from(
        hero,
        {
          autoAlpha: 0,
          y: 28,
          scale: 0.985,
          duration: 0.85,
          ease: "power4.out"
        },
        "frame"
      );

      if (backdrop) {
        intro.from(backdrop, { scale: 1.18, duration: 1.8, ease: "power3.out" }, "frame");
      }
      if (heroGrid) {
        intro.from(heroGrid, { autoAlpha: 0, scale: 1.08, duration: 1.15 }, "frame+=0.12");
      }
      if (backLink) {
        intro.from(backLink, { autoAlpha: 0, x: -24, duration: 0.48 }, "frame+=0.18");
      }
      if (heroHud) {
        intro.from(heroHud, { autoAlpha: 0, x: 24, duration: 0.48 }, "<");
      }
      if (heroCover) {
        intro.from(
          heroCover,
          {
            autoAlpha: 0,
            y: isWide ? 64 : 34,
            rotationX: isWide ? 8 : 0,
            rotationY: isWide ? -15 : 0,
            scale: 0.9,
            duration: 1.05,
            ease: "back.out(1.35)"
          },
          "frame+=0.24"
        );
      }
      if (heroKicker) {
        intro.from(heroKicker, { autoAlpha: 0, x: 24, duration: 0.5 }, "frame+=0.38");
      }
      if (heroTitle) {
        intro.from(
          heroTitle,
          {
            autoAlpha: 0,
            x: isWide ? 46 : 0,
            y: isWide ? 0 : 22,
            skewX: -5,
            duration: 0.82,
            ease: "power4.out"
          },
          "frame+=0.43"
        );
      }
      if (heroTags.length > 0) {
        intro.from(
          heroTags,
          {
            autoAlpha: 0,
            y: 18,
            scale: 0.78,
            stagger: 0.055,
            duration: 0.45,
            ease: "back.out(1.8)"
          },
          "frame+=0.58"
        );
      }
      if (heroButtons.length > 0) {
        intro.from(
          heroButtons,
          {
            autoAlpha: 0,
            y: 24,
            stagger: 0.09,
            duration: 0.58,
            ease: "back.out(1.45)"
          },
          "frame+=0.7"
        );
      }

      const heroScroll = gsap.timeline({
        scrollTrigger: {
          trigger: hero,
          start: "top top+=96",
          end: "bottom top",
          scrub: 0.9
        }
      });
      if (backdrop) {
        heroScroll.to(backdrop, { yPercent: 16, scale: 1.08, ease: "none" }, 0);
      }
      if (heroGrid) {
        heroScroll.to(heroGrid, { yPercent: 14, rotation: 0.8, ease: "none" }, 0);
      }
      if (heroCopy) {
        heroScroll.to(heroCopy, { y: isWide ? -34 : -18, ease: "none" }, 0);
      }

      const metricCards = selectAll<HTMLElement>("[data-metric]");
      const metrics = select<HTMLElement>(".detail-metrics");
      if (metrics && metricCards.length > 0) {
        const metricsTimeline = gsap.timeline({
          defaults: { ease: "power3.out" },
          scrollTrigger: {
            trigger: metrics,
            start: "top 90%",
            once: true
          }
        });
        metricsTimeline
          .from(metricCards, {
            autoAlpha: 0,
            y: 64,
            rotationX: -18,
            scale: 0.9,
            stagger: 0.085,
            duration: 0.78
          })
          .from(
            metricCards.map((card) => card.querySelector(":scope > span")).filter((item): item is Element => item !== null),
            {
              scale: 0,
              rotation: -120,
              stagger: 0.065,
              duration: 0.5,
              ease: "back.out(1.9)"
            },
            "-=0.48"
          );
      }

      selectAll<HTMLElement>("[data-reveal]").forEach((panel, panelIndex) => {
        const isSidebar = panel.closest(".detail-sidebar") !== null;
        const directChildren = Array.from(panel.children).filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && !child.matches("dl, ul, .screenshot-grid")
        );
        const listItems = Array.from(
          panel.querySelectorAll<HTMLElement>(".metadata-panel dl > div, .platform-time li, .screenshot-grid > a")
        );
        const timeline = gsap.timeline({
          defaults: { ease: "power3.out" },
          scrollTrigger: {
            trigger: panel,
            start: "top 87%",
            once: true
          }
        });

        timeline.from(panel, {
          autoAlpha: 0,
          x: isWide ? (isSidebar ? 38 : -26) : 0,
          y: isWide ? 54 : 38,
          rotationX: isWide ? 7 : 0,
          rotationZ: isWide ? (panelIndex % 2 === 0 ? -0.7 : 0.7) : 0,
          scale: 0.965,
          duration: 0.82
        });

        if (directChildren.length > 0) {
          timeline.from(
            directChildren,
            {
              autoAlpha: 0,
              y: 20,
              stagger: 0.07,
              duration: 0.52
            },
            "-=0.54"
          );
        }
        if (listItems.length > 0) {
          timeline.from(
            listItems,
            {
              autoAlpha: 0,
              x: (index: number) => (index % 2 === 0 ? -22 : 22),
              rotationY: (index: number) => (index % 2 === 0 ? -7 : 7),
              stagger: 0.075,
              duration: 0.54
            },
            "-=0.34"
          );
        }

        const progressFill = panel.querySelector<HTMLElement>(".achievement__track span");
        if (progressFill) {
          timeline.from(
            progressFill,
            {
              scaleX: 0,
              transformOrigin: "left center",
              duration: 1.15,
              ease: "power3.inOut"
            },
            "-=0.24"
          );
        }
      });

      const orbs = selectAll<HTMLElement>(".detail-orb");
      orbs.forEach((orb, index) => {
        gsap.to(orb, {
          x: index % 2 === 0 ? 42 : -36,
          y: index === 1 ? 52 : -46,
          rotation: index % 2 === 0 ? 24 : -20,
          scale: index === 2 ? 1.16 : 0.88,
          duration: 5.5 + index * 1.35,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true
        });
      });

      if (heroFlare) {
        gsap.to(heroFlare, {
          rotation: 360,
          duration: 18,
          ease: "none",
          repeat: -1
        });
      }
      if (heroScan) {
        gsap
          .timeline({ repeat: -1, repeatDelay: 1.15 })
          .fromTo(
            heroScan,
            { autoAlpha: 0, y: -90 },
            { autoAlpha: 0.82, y: () => hero.offsetHeight + 90, duration: 3.7, ease: "none" }
          )
          .to(heroScan, { autoAlpha: 0, duration: 0.08 });
      }
      if (titleEcho) {
        gsap
          .timeline({ repeat: -1, repeatDelay: 3.4 })
          .to(titleEcho, { autoAlpha: 0.72, x: 4, duration: 0.055, ease: "none" })
          .to(titleEcho, { autoAlpha: 0.18, x: -3, duration: 0.055, ease: "none" })
          .to(titleEcho, { autoAlpha: 0.45, x: 2, duration: 0.055, ease: "none" })
          .to(titleEcho, { autoAlpha: 0, x: 0, duration: 0.08, ease: "none" });
      }

      const communityIcon = select<HTMLElement>("[data-community-card] > span");
      if (communityIcon) {
        gsap.to(communityIcon, {
          y: -7,
          rotation: 5,
          scale: 1.04,
          duration: 1.65,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true
        });
      }

      const finePointer = isWide && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (finePointer && heroCursor && heroCover) {
        gsap.set(heroCursor, { x: hero.clientWidth * 0.7, y: hero.clientHeight * 0.32 });
        gsap.set(heroCover, { transformPerspective: 1000, transformOrigin: "center center" });
        const cursorX = gsap.quickTo(heroCursor, "x", { duration: 0.42, ease: "power3.out" });
        const cursorY = gsap.quickTo(heroCursor, "y", { duration: 0.42, ease: "power3.out" });
        const coverRotateX = gsap.quickTo(heroCover, "rotationX", { duration: 0.5, ease: "power3.out" });
        const coverRotateY = gsap.quickTo(heroCover, "rotationY", { duration: 0.5, ease: "power3.out" });
        const coverX = gsap.quickTo(heroCover, "x", { duration: 0.5, ease: "power3.out" });
        const coverY = gsap.quickTo(heroCover, "y", { duration: 0.5, ease: "power3.out" });
        const backdropX = backdrop ? gsap.quickTo(backdrop, "xPercent", { duration: 0.8, ease: "power3.out" }) : null;

        const onHeroMove = (event: PointerEvent) => {
          const bounds = hero.getBoundingClientRect();
          const x = event.clientX - bounds.left;
          const y = event.clientY - bounds.top;
          const normalizedX = x / bounds.width - 0.5;
          const normalizedY = y / bounds.height - 0.5;
          cursorX(x);
          cursorY(y);
          coverRotateX(normalizedY * -8);
          coverRotateY(normalizedX * 10);
          coverX(normalizedX * 9);
          coverY(normalizedY * 7);
          backdropX?.(normalizedX * -2.2);
        };
        const onHeroLeave = () => {
          coverRotateX(0);
          coverRotateY(0);
          coverX(0);
          coverY(0);
          backdropX?.(0);
        };

        hero.addEventListener("pointermove", onHeroMove);
        hero.addEventListener("pointerleave", onHeroLeave);
        cleanups.push(() => {
          hero.removeEventListener("pointermove", onHeroMove);
          hero.removeEventListener("pointerleave", onHeroLeave);
        });
      }

      if (finePointer) {
        selectAll<HTMLElement>("[data-tilt]").forEach((card) => {
          gsap.set(card, { transformPerspective: 900, transformOrigin: "center center" });
          const rotateX = gsap.quickTo(card, "rotationX", { duration: 0.36, ease: "power3.out" });
          const rotateY = gsap.quickTo(card, "rotationY", { duration: 0.36, ease: "power3.out" });
          const depth = gsap.quickTo(card, "z", { duration: 0.36, ease: "power3.out" });
          const intensity = card.matches("[data-screenshot]") ? 9 : 6;
          const onMove = (event: PointerEvent) => {
            const bounds = card.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / bounds.width - 0.5;
            const y = (event.clientY - bounds.top) / bounds.height - 0.5;
            rotateX(y * -intensity);
            rotateY(x * intensity);
            depth(9);
          };
          const onLeave = () => {
            rotateX(0);
            rotateY(0);
            depth(0);
          };
          card.addEventListener("pointermove", onMove);
          card.addEventListener("pointerleave", onLeave);
          cleanups.push(() => {
            card.removeEventListener("pointermove", onMove);
            card.removeEventListener("pointerleave", onLeave);
          });
        });

        heroButtons.forEach((button) => {
          const moveX = gsap.quickTo(button, "x", { duration: 0.32, ease: "power3.out" });
          const moveY = gsap.quickTo(button, "y", { duration: 0.32, ease: "power3.out" });
          const onMove = (event: PointerEvent) => {
            const bounds = button.getBoundingClientRect();
            moveX(((event.clientX - bounds.left) / bounds.width - 0.5) * 12);
            moveY(((event.clientY - bounds.top) / bounds.height - 0.5) * 9);
          };
          const onLeave = () => {
            moveX(0);
            moveY(0);
          };
          button.addEventListener("pointermove", onMove);
          button.addEventListener("pointerleave", onLeave);
          cleanups.push(() => {
            button.removeEventListener("pointermove", onMove);
            button.removeEventListener("pointerleave", onLeave);
          });
        });
      }

      requestAnimationFrame(() => ScrollTrigger.refresh());

      return () => {
        cleanups.forEach((cleanup) => cleanup());
        root.classList.remove("is-gsap-ready");
      };
    },
    root
  );

  document.addEventListener("astro:before-swap", () => matchMedia.revert(), { once: true });
}
};

if (document.documentElement.dataset.bootState === "complete") {
  initDetailEffects();
} else {
  window.addEventListener("game-wall:boot-complete", initDetailEffects, { once: true });
}
