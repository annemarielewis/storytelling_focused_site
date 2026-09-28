/* ==========================================================================
   Ripple House — shared site behaviour
   No frameworks, no build step. Everything here is vanilla JS.
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Hero: background reel -> freeze on last frame -> precise entrance timeline ----------
     Driven by two plain local <video> elements (media/banner_web.mp4 and
     media/cinematography_reel_web.mp4) — no external API/network dependency:
       1. Background reel autoplays permanently muted, at full/normal brightness
          (no controls of any kind on it — not even a mute toggle, and nothing else
          on the page is visible — see body.intro-pending in css/style.css); once
          it reports it's actually playing, the hero-bg-video wrapper fades in from
          black over .5s (CSS opacity transition). It is never dimmed while playing.
       2. We poll playback time against duration and pause a hair before the true end,
          so it freezes on (essentially) its last frame instead of looping/flashing
          back to frame 0.
       3. That freeze is the ONLY trigger for what happens next: beginEntrance(),
          which runs this exact timeline from a single t=0 origin (absolute
          setTimeout delays, not chained, so the offsets stay exact):
            t=0.000s  "A.M. Lewis" AND the navigation menu (see
                      .nav-controls in css/style.css) start fading in
                      together (see .site-nav .brand) AND the background
                      starts dimming by 20% (see .hero-bg-video.is-dimmed)
                      — all three over exactly 2.5s, finishing at t=2.500s.
            t=1.000s  the overlay video starts fading in, over exactly 1s
                      (see .video-frame) — this overlaps the tail end of
                      the brand/nav/dim animation above by design.
            t=2.125s  .125s after that fade completes, the caption below the
                      reel starts typing itself out, at 4.5x the base
                      per-character rate (see typewriter() below) — and, at
                      this exact same instant, the awards/logo scroller
                      behind it starts sliding on from the right at a fixed
                      speed (AWARDS_SPEED below) and, the instant it's fully
                      on screen, keeps going at that exact same speed in a
                      seamless, indefinite loop (see startAwardsScroll()). */
  // The background layer is now an animated quote (#hero-quote-el), not a
  // video — see runQuoteIntro() below. Its "settle" replaces the old
  // freeze-on-last-frame as the t=0 trigger for beginEntrance().
  const bgQuote = document.getElementById('hero-quote-el');
  const overlayVideo = document.getElementById('hero-overlay-video-el');
  // Set synchronously, before first paint, by the inline <script> at the
  // top of index.html's <body> (see its comment for the full rationale) —
  // true only when this visitor already played the entrance earlier in
  // the current site session (sessionStorage), which is exactly the
  // "already visited or clicked Home" case the skip behavior targets.
  const skipIntro = document.body.classList.contains('intro-skip');

  if (bgQuote || overlayVideo) {
    const bgWrap = document.querySelector('.hero-bg-video');
    const overlayWrap = document.querySelector('.hero-overlay');
    const overlayMuteToggle = document.querySelector('.overlay-mute-toggle');
    const heroLink = document.querySelector('.hero-link');
    const typedTextEl = heroLink ? heroLink.querySelector('.typed-text') : null;
    const typedCursorEl = heroLink ? heroLink.querySelector('.typed-cursor') : null;
    const belowReel = document.querySelector('.hero-below-reel');
    const videoFrame = document.querySelector('.hero-overlay .video-frame');
    const heroInner = document.querySelector('.hero-inner');
    const awardsBand = document.querySelector('.awards-band');
    const awardsEnter = document.querySelector('.awards-enter');
    const awardsTrack = document.querySelector('.awards-track');
    const awardsSet = document.querySelector('.awards-set');
    // Fixed px/s speed for the whole awards scroller — entrance AND loop
    // both move at exactly this rate (see startAwardsScroll() below), so
    // there's one constant speed throughout with no separate/faster
    // entrance phase. This is 2x the strip's previous steady-state speed
    // (a ~1216.6px set width over a 30s loop, ~40.55px/s), doubled.
    const AWARDS_SPEED = 81.1; // px/s

    let watcherStarted = false;
    let entranceStarted = false;
    let overlayMuted = true;

    // Keeps .hero-below-reel (the caption + awards scroller) anchored to
    // start exactly at the reel's rendered bottom edge, so flex centering
    // inside it lands both dead center in the space between the reel and
    // the bottom of the viewport. The reel's own position/size never
    // changes because of this — it's only ever read, never written — but
    // it IS responsive (width: 70vw, aspect-ratio-driven height), so this
    // has to be re-measured on load and on every resize.
    // The reel renders at REEL_SCALE of its original size (see the
    // .hero-overlay .video-frame width in css/style.css). Layout, run on
    // load, on resize, and again when the awards strip starts:
    //   1. Work out where the bottom of the ORIGINAL full-size reel would
    //      be (same center, height / REEL_SCALE) and anchor the caption +
    //      awards strip there — so they stay exactly where they were.
    //   2. Shift the smaller reel vertically so it sits centered between
    //      the bottom of the nav bar and the top of the caption.
    const REEL_SCALE = 0.88;
    const siteNav = document.querySelector('.site-nav');
    function positionBelowReel() {
      if (!belowReel || !videoFrame || !heroInner) return;
      if (overlayWrap) overlayWrap.style.transform = '';
      const frameRect = videoFrame.getBoundingClientRect();
      const innerTop = heroInner.getBoundingClientRect().top;
      const frameCenter = frameRect.top + frameRect.height / 2;
      const fullBottom = frameCenter + (frameRect.height / REEL_SCALE) / 2;
      belowReel.style.top = Math.max(0, fullBottom - innerTop) + 'px';
      if (!overlayWrap || !heroLink) return;
      const captionTop = heroLink.getBoundingClientRect().top;
      const navBottom = siteNav ? siteNav.getBoundingClientRect().bottom : innerTop;
      const targetCenter = (navBottom + captionTop) / 2;
      overlayWrap.style.transform = 'translateY(' + (targetCenter - frameCenter) + 'px)';
    }
    positionBelowReel();
    window.addEventListener('resize', positionBelowReel);
    window.addEventListener('load', positionBelowReel);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionBelowReel);

    // Starts the awards/logo scroller — called from the exact same
    // setTimeout tick as typewriter() below, so the two are perfectly
    // synchronized. Re-measures positionBelowReel() first in case a resize
    // happened during the intro.
    //
    // Timing is computed, not hardcoded, so both phases hold the exact
    // same AWARDS_SPEED:
    //   - .awards-enter slides translateX(100vw) -> 0 (see css/style.css);
    //     100vw is a different PIXEL distance at every viewport width, so
    //     its duration has to be (current viewport width in px) / SPEED.
    //   - .awards-track then loops translateX(0) -> -50% forever; its
    //     duration is (one rendered .awards-set's width, incl. its
    //     trailing gap) / SPEED, and it's delayed to start exactly when
    //     the entrance's duration ends — so the entrance is finished and
    //     motionless (fill-mode: forwards) the instant the loop picks up,
    //     and only one of the two is ever actually moving. That hand-off,
    //     not a shared speed alone, is what removes the old compounding
    //     ("fast entrance, slower settle") effect entirely.
    function startAwardsScroll() {
      positionBelowReel();
      if (!awardsBand || !awardsEnter || !awardsTrack || !awardsSet) return;
      const viewportWidth = awardsBand.getBoundingClientRect().width || window.innerWidth;
      const setWidth = awardsSet.getBoundingClientRect().width;
      const enterDuration = viewportWidth / AWARDS_SPEED;
      const loopDuration = setWidth / AWARDS_SPEED;
      awardsEnter.style.animationDuration = enterDuration + 's';
      awardsTrack.style.animationDuration = loopDuration + 's';
      awardsTrack.style.animationDelay = enterDuration + 's';
      awardsBand.classList.add('is-scrolling');
    }

    // Types the caption (read from the link's aria-label, so the visible
    // text and the accessible name can never drift apart) one character at
    // a time with a little random jitter for a natural feel. The cursor
    // starts blinking the instant this fires and is never told to stop, so
    // it keeps blinking after the last character lands too.
    function typewriter() {
      if (!heroLink || !typedTextEl) return;
      const fullText = heroLink.getAttribute('aria-label') || '';
      heroLink.classList.add('is-typing');
      if (typedCursorEl) typedCursorEl.classList.add('is-visible');
      let i = 0;
      const typeNext = () => {
        if (i >= fullText.length) return;
        typedTextEl.textContent += fullText.charAt(i);
        i++;
        setTimeout(typeNext, 63 + Math.random() * 76.5); // ~63–139.5ms per character (2x faster than the prior 126–279ms rate)
      };
      typeNext();
    }

    // Fires once, the instant the background reel freezes on its last frame
    // (or, via the safety-net timeout below, if it never gets there at
    // all). This is t=0.000s of the timeline described in the comment
    // above — everything from here on is scheduled from this single origin.
    // On a repeat Home visit this session (skipIntro), every delay below
    // collapses to 0 — same calls, same classes, same typewriter()/
    // startAwardsScroll(), just fired back-to-back on one tick instead of
    // spread across the timeline, and the transitions those classes gate
    // are themselves neutralized to 0s under body.intro-skip (see
    // css/style.css), so nothing here animates into view — it's just
    // already-settled chrome, with typing starting essentially instantly.
    // The first-visit path (skipIntro === false) is completely unchanged.
    function beginEntrance() {
      if (entranceStarted) return;
      entranceStarted = true;

      if (bgWrap) bgWrap.classList.add('is-dimmed');   // t=0.000s — 20% dim over 2.5s (instant when skipIntro)
      document.body.classList.remove('intro-pending'); // t=0.000s — brand + nav menu fade in over 2.5s (instant when skipIntro)

      setTimeout(() => {                                // t=1.000s (t=0 when skipIntro)
        if (overlayWrap) overlayWrap.classList.add('is-visible'); // video-frame fades in over 1s (instant when skipIntro)
        if (bgQuote) bgQuote.classList.add('is-fading-out'); // quote fades out over the same 1s, same easing, same instant
        if (bgWrap) bgWrap.classList.add('is-fading-out');     // ...along with its dark backdrop...
        document.body.classList.add('is-bg-revealed');        // ...revealing the page's background photo underneath, same 1s
        if (overlayVideo) {
          overlayVideo.muted = true; // stays muted until the visitor opts in
          overlayVideo.play().catch(() => {});
        }
      }, skipIntro ? 0 : 1000);

      setTimeout(() => {                                // t=2.125s (t=0 when skipIntro)
        startAwardsScroll(); // awards images start entering from the right...
        typewriter();        // ...at the exact same instant typing begins
      }, skipIntro ? 0 : 2125);
    }

    // Background quote intro. Splits the sentence into per-word spans
    // (preserving the <em> "human story" accent), then staggers them in.
    // Timeline (first visit): wrapper fades in from black over .5s, words
    // start at .3s, one every QUOTE_STAGGER ms, each animating over
    // QUOTE_WORD_MS; the brass rule draws in as the last word lands; after
    // a short hold the quote is "settled" — that is t=0.000s for
    // beginEntrance(), exactly where the old video freeze used to fire.
    const QUOTE_START = 300;     // ms after the layer starts fading in
    const QUOTE_STAGGER = 140;   // ms between words
    const QUOTE_WORD_MS = 1100;  // matches hq-word-in in css/style.css
    const QUOTE_HOLD = 1650;     // ms to let it sit, fully formed, before the entrance (was 1400; +0.25s reading time)

    function splitQuoteWords(root) {
      const words = [];
      const walk = (node) => {
        Array.from(node.childNodes).forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) {
            const frag = document.createDocumentFragment();
            child.textContent.split(/(\s+)/).forEach(part => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
              const span = document.createElement('span');
              span.className = 'hq-word';
              span.textContent = part;
              frag.appendChild(span);
              words.push(span);
            });
            child.replaceWith(frag);
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            walk(child);
          }
        });
      };
      walk(root);
      return words;
    }

    function runQuoteIntro() {
      const textEl = bgQuote.querySelector('.hero-quote-text');
      // Shadow layer: an invisible copy of the quote sitting exactly behind
      // it that carries the heavy text-shadow. It's drawn once and then only
      // its opacity is faded (cheap for the browser), instead of animating
      // the shadow on the live text, which made the animation stutter.
      if (textEl) {
        const shadowEl = textEl.cloneNode(true);
        shadowEl.classList.add('hero-quote-shadow');
        shadowEl.setAttribute('aria-hidden', 'true');
        textEl.parentNode.insertBefore(shadowEl, textEl);
      }
      const words = textEl ? splitQuoteWords(textEl) : [];
      if (skipIntro) {
        bgQuote.classList.add('is-complete');
        if (bgWrap) bgWrap.classList.add('is-ready');
        beginEntrance();
        return;
      }
      words.forEach((w, i) => w.style.setProperty('--hq-delay', (i * QUOTE_STAGGER) / 1000 + 's'));
      requestAnimationFrame(() => { if (bgWrap) bgWrap.classList.add('is-ready'); });
      setTimeout(() => bgQuote.classList.add('is-animating'), QUOTE_START);
      const lastLands = QUOTE_START + Math.max(0, words.length - 1) * QUOTE_STAGGER + QUOTE_WORD_MS;
      setTimeout(() => bgQuote.classList.add('is-ruled'), lastLands - 300);
      setTimeout(beginEntrance, lastLands + QUOTE_HOLD); // settle is the trigger — t=0.000s
    }

    if (bgQuote) runQuoteIntro();

    // Safety net: if the quote intro never reaches its settle for any
    // reason, still bring everything up so the page isn't left blank.
    // (The quote's own timeline finishes well before this.)
    setTimeout(beginEntrance, 9000);

    if (overlayMuteToggle) {
      const overlayIcon = overlayMuteToggle.querySelector('.mute-icon');
      overlayMuteToggle.addEventListener('click', () => {
        if (!overlayVideo) return;
        overlayMuted = !overlayMuted;
        overlayVideo.muted = overlayMuted;
        overlayMuteToggle.setAttribute('aria-pressed', String(!overlayMuted));
        overlayMuteToggle.setAttribute('aria-label', overlayMuted ? 'Unmute video' : 'Mute video');
        if (overlayIcon) overlayIcon.classList.toggle('is-on', !overlayMuted);
      });
    }
  }

  /* ---------- Nav: solid-on-scroll + mobile toggle ---------- */
  const nav = document.querySelector('.site-nav');
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('is-scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const open = navToggle.classList.toggle('is-open');
      navLinks.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', String(open));
    });
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navToggle.classList.remove('is-open');
        navLinks.classList.remove('is-open');
      });
    });
  }

  /* ---------- Tape-counter scroll readout (signature element) ---------- */
  const counter = document.querySelector('.tape-counter .reading');
  if (counter) {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? window.scrollY / max : 0;
      const totalSeconds = Math.floor(pct * 599); // fake 0:00–9:59 tape reel
      const m = Math.floor(totalSeconds / 60);
      const s = String(totalSeconds % 60).padStart(2, '0');
      counter.textContent = `${m}:${s}`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-item').forEach(item => {
    const q = item.querySelector('.faq-q');
    const a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');
      // close siblings
      item.parentElement.querySelectorAll('.faq-item.is-open').forEach(sib => {
        if (sib !== item) {
          sib.classList.remove('is-open');
          sib.querySelector('.faq-a').style.maxHeight = null;
          sib.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('is-open', !isOpen);
      q.setAttribute('aria-expanded', String(!isOpen));
      a.style.maxHeight = !isOpen ? a.scrollHeight + 'px' : null;
    });
  });

  /* ---------- Slideshow (Live Action page) ----------
     Page-agnostic, same pattern as the FAQ accordion above: guarded on
     .slideshow existing, so this is a no-op everywhere else. A single
     <img> has its src swapped on navigation (rather than pre-rendering all
     104 slides into the DOM), so only the current slide plus its two
     immediate neighbors (preloaded below) are ever fetched. */
  document.querySelectorAll('.slideshow').forEach(el => {
    const count = parseInt(el.getAttribute('data-slide-count'), 10) || 0;
    const base = el.getAttribute('data-slide-base') || '';
    const ext = el.getAttribute('data-slide-ext') || '.jpg';
    const pad = parseInt(el.getAttribute('data-slide-pad'), 10) || 3;
    const img = el.querySelector('.slideshow-img');
    const prevBtn = el.querySelector('.slideshow-prev');
    const nextBtn = el.querySelector('.slideshow-next');
    const currentEl = el.querySelector('.slideshow-current');
    const totalEl = el.querySelector('.slideshow-total');
    if (!count || !img) return;

    let index = 1; // 1-based

    const slidePath = (n) => `${base}${String(n).padStart(pad, '0')}${ext}`;
    const preload = (n) => { const im = new Image(); im.src = slidePath(n); };

    const render = () => {
      img.src = slidePath(index);
      img.alt = `Live Action slideshow, slide ${index} of ${count}`;
      if (currentEl) currentEl.textContent = String(index);
      preload(index === count ? 1 : index + 1);
      preload(index === 1 ? count : index - 1);
    };

    const go = (delta) => {
      index = ((index - 1 + delta + count) % count) + 1;
      render();
    };

    prevBtn?.addEventListener('click', () => go(-1));
    nextBtn?.addEventListener('click', () => go(1));

    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    });

    // touch swipe (mobile)
    let touchStartX = null;
    el.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      touchStartX = null;
    }, { passive: true });

    if (totalEl) totalEl.textContent = String(count);
    render();
  });

  /* ---------- About page: tab switcher (About / My Passion / Experience) ----------
     Standard ARIA tablist pattern — click, or Left/Right arrow keys while a
     tab has focus, switches which .about-panel is shown and moves the
     "active" (--brass-light) styling to the matching .about-tab. Fully
     guarded on .about-tab existing, so this is a no-op on every other page
     — only about.html has these elements. */
  const aboutTabs = Array.from(document.querySelectorAll('.about-tab'));
  if (aboutTabs.length) {
    const aboutPanels = document.querySelectorAll('.about-panel');
    const activateAboutTab = (tab) => {
      if (!tab || tab.classList.contains('is-active')) return;
      aboutTabs.forEach(t => {
        const isTarget = t === tab;
        t.classList.toggle('is-active', isTarget);
        t.setAttribute('aria-selected', String(isTarget));
        t.tabIndex = isTarget ? 0 : -1;
      });
      aboutPanels.forEach(p => {
        p.hidden = p.id !== tab.getAttribute('aria-controls');
      });
    };
    aboutTabs.forEach((tab, i) => {
      tab.tabIndex = tab.classList.contains('is-active') ? 0 : -1;
      tab.addEventListener('click', () => activateAboutTab(tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const next = aboutTabs[(i + dir + aboutTabs.length) % aboutTabs.length];
        next.focus();
        activateAboutTab(next);
      });
    });
  }

  /* ---------- Video modal (popup overlay embed) ---------- */
  const modal = document.getElementById('video-modal');
  if (modal) {
    const frame = modal.querySelector('iframe');
    const closeBtn = modal.querySelector('.video-modal-close');
    const backdropClose = (e) => { if (e.target === modal) close(); };

    const open = (embedUrl) => {
      frame.src = embedUrl + (embedUrl.includes('?') ? '&' : '?') + 'autoplay=1';
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      modal.classList.remove('is-open');
      frame.src = '';
      document.body.style.overflow = '';
    };

    const modalLabel = modal.querySelector('.video-modal-label');
    document.querySelectorAll('[data-video-popup]').forEach(trigger => {
      trigger.addEventListener('click', () => {
        if (modalLabel) modalLabel.textContent = trigger.getAttribute('data-video-label') || '';
        open(trigger.getAttribute('data-video-popup'));
      });
    });
    closeBtn?.addEventListener('click', close);
    modal.addEventListener('click', backdropClose);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  /* ---------- Claymation/Storyboard video modal (local file playback) ----------
     Separate id/data-attribute from the iframe-based #video-modal above
     (that one is unused elsewhere on the site, but this stays fully
     independent regardless) — this modal plays a local <video> instead of
     an embed. Reuses the same .video-modal/.video-modal-inner/
     .video-modal-close/.video-frame/.video-modal-label CSS. Guarded on
     #clay-video-modal existing, so this only runs on claymation.html. */
  const clayModal = document.getElementById('clay-video-modal');
  if (clayModal) {
    const player = clayModal.querySelector('.clay-video-modal-player');
    const clayCloseBtn = clayModal.querySelector('.video-modal-close');
    const clayLabel = clayModal.querySelector('.video-modal-label');
    const clayBackdropClose = (e) => { if (e.target === clayModal) clayClose(); };

    const clayOpen = (src, label) => {
      player.src = src;
      clayLabel.textContent = label || '';
      clayModal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      player.play().catch(() => {});
    };
    const clayClose = () => {
      clayModal.classList.remove('is-open');
      player.pause();
      player.removeAttribute('src');
      player.load();
      document.body.style.overflow = '';
    };

    document.querySelectorAll('[data-clay-video]').forEach(trigger => {
      trigger.addEventListener('click', () => clayOpen(trigger.getAttribute('data-clay-video'), trigger.getAttribute('data-video-label')));
    });
    clayCloseBtn?.addEventListener('click', clayClose);
    clayModal.addEventListener('click', clayBackdropClose);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && clayModal.classList.contains('is-open')) clayClose(); });
  }

  /* ---------- Review banner manual scroll (Podcasts page) ----------
     Arrow-driven, not automatic: each click moves .review-viewport by
     exactly one card's rendered width (+ the track's gap) via
     scrollBy(), relying on the viewport's own native scrolling (CSS
     scroll-behavior:smooth handles the easing, scroll-snap-align on each
     card is what makes it settle cleanly rather than mid-card) — so
     touch/trackpad swipe on the viewport keeps working too, the arrows
     just aren't the only way to move it. Each arrow gets .is-disabled
     (see css/style.css) once there's nothing left to scroll to on that
     side, re-checked on every scroll event (covers arrow clicks AND
     manual swipe/drag alike). Guarded on .review-banner existing, so this
     is a no-op everywhere else. */
  const reviewBanner = document.querySelector('.review-banner');
  if (reviewBanner) {
    const reviewViewport = reviewBanner.querySelector('.review-viewport');
    const reviewTrack = reviewBanner.querySelector('.review-track');
    const reviewPrevBtn = reviewBanner.querySelector('.review-arrow-prev');
    const reviewNextBtn = reviewBanner.querySelector('.review-arrow-next');
    if (reviewViewport && reviewTrack && reviewPrevBtn && reviewNextBtn) {
      const firstCard = reviewTrack.querySelector('.review-shot-card');
      const reviewStep = () => {
        if (!firstCard) return reviewViewport.clientWidth;
        const gap = parseFloat(getComputedStyle(reviewTrack).columnGap || getComputedStyle(reviewTrack).gap || '0') || 0;
        return firstCard.getBoundingClientRect().width + gap;
      };
      const updateReviewArrows = () => {
        const maxScroll = reviewViewport.scrollWidth - reviewViewport.clientWidth;
        reviewPrevBtn.classList.toggle('is-disabled', reviewViewport.scrollLeft <= 2);
        reviewNextBtn.classList.toggle('is-disabled', reviewViewport.scrollLeft >= maxScroll - 2);
      };
      reviewPrevBtn.addEventListener('click', () => reviewViewport.scrollBy({ left: -reviewStep(), behavior: 'smooth' }));
      reviewNextBtn.addEventListener('click', () => reviewViewport.scrollBy({ left: reviewStep(), behavior: 'smooth' }));
      reviewViewport.addEventListener('scroll', updateReviewArrows, { passive: true });
      window.addEventListener('resize', updateReviewArrows);
      updateReviewArrows();
    }
  }

  /* ---------- Review screenshot lightbox (Podcasts page) ----------
     Same open/close/backdrop-click/Escape pattern as the video modals
     above, reusing the shared .video-modal shell (see #review-image-modal
     in podcasts.html and "Apple Reviews banner + lightbox" in
     css/style.css) but swapping an <img src> instead of a video/iframe
     src. Guarded on #review-image-modal existing, so this is a no-op
     everywhere else. */
  const reviewModal = document.getElementById('review-image-modal');
  if (reviewModal) {
    const reviewImg = reviewModal.querySelector('.review-image-modal-img');
    const reviewCloseBtn = reviewModal.querySelector('.video-modal-close');
    const reviewBackdropClose = (e) => { if (e.target === reviewModal) reviewClose(); };

    const reviewOpen = (src, label) => {
      reviewImg.src = src;
      reviewImg.alt = label || '';
      reviewModal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    };
    const reviewClose = () => {
      reviewModal.classList.remove('is-open');
      reviewImg.src = '';
      document.body.style.overflow = '';
    };

    document.querySelectorAll('[data-review-image]').forEach(trigger => {
      trigger.addEventListener('click', () => reviewOpen(trigger.getAttribute('data-review-image'), trigger.getAttribute('data-review-label')));
    });
    reviewCloseBtn?.addEventListener('click', reviewClose);
    reviewModal.addEventListener('click', reviewBackdropClose);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && reviewModal.classList.contains('is-open')) reviewClose(); });
  }

  /* ---------- Contact drawer ---------- */
  const drawer = document.getElementById('contact-drawer');
  const drawerBackdrop = document.getElementById('contact-backdrop');
  if (drawer && drawerBackdrop) {
    const openDrawer = () => {
      drawer.classList.add('is-open');
      drawerBackdrop.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    };
    const closeDrawer = () => {
      drawer.classList.remove('is-open');
      drawerBackdrop.classList.remove('is-open');
      document.body.style.overflow = '';
    };
    document.querySelectorAll('.talk-trigger').forEach(t => t.addEventListener('click', (e) => {
      e.preventDefault();
      openDrawer();
    }));
    drawer.querySelector('.contact-drawer-close')?.addEventListener('click', closeDrawer);
    drawerBackdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

    /* Static-site form handling: this demo just shows a success message.
       Wire this up to Formspree, Netlify Forms, Getform, or similar for
       a real inbox — see README for notes. */
    const form = document.getElementById('contact-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        form.querySelector('.form-msg.success')?.classList.add('is-visible');
        form.reset();
      });
    }
  }

  /* ---------- Discog: lightweight custom audio player ---------- */
  const tracks = document.querySelectorAll('.track[data-audio]');
  if (tracks.length) {
    let currentAudio = null;
    let currentTrack = null;

    tracks.forEach(track => {
      const btn = track.querySelector('.track-play');
      const src = track.getAttribute('data-audio');
      btn.addEventListener('click', () => {
        if (currentTrack === track) {
          // toggle play/pause on the same track
          if (currentAudio.paused) { currentAudio.play(); track.classList.add('is-playing'); }
          else { currentAudio.pause(); track.classList.remove('is-playing'); }
          return;
        }
        // switch tracks
        if (currentAudio) { currentAudio.pause(); currentTrack?.classList.remove('is-playing'); }
        currentAudio = new Audio(src);
        currentTrack = track;
        currentAudio.play().catch(() => {
          /* file likely missing until real audio is dropped into /audio */
        });
        track.classList.add('is-playing');
        currentAudio.addEventListener('ended', () => track.classList.remove('is-playing'));
      });
    });
  }

  /* ---------- Active nav link ----------
     Normalizes both the current URL and each nav link's href down to a
     bare page name (no leading/trailing slash, no .html) before comparing,
     rather than comparing raw path strings. Locally the site is served as
     plain files (pathname ends in e.g. "/about.html"), but Netlify's
     deployed/pretty-URL paths can present the same page as "/about/" or
     "/about" with no extension at all — the old exact-string match only
     ever matched the local form, which broke .is-active (and, downstream,
     the Work/Accolades pink+yellow active-state highlighting added above
     via :has() in css/style.css) on the live Netlify site while it kept
     working locally. Root "/" and "index.html" both normalize to "index"
     so Home still matches at the site root either way. */
  function normalizeNavPath(pathname) {
    let p = pathname.split(/[?#]/)[0];             // strip any query/hash defensively
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1); // trailing slash, but keep root "/" as-is
    let seg = p.split('/').pop();                  // last path segment
    if (!seg) seg = 'index';                        // root "/" -> "index"
    seg = seg.replace(/\.html$/i, '');              // drop .html if present
    return seg.toLowerCase();
  }
  const currentPage = normalizeNavPath(location.pathname);
  document.querySelectorAll('.nav-links a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (normalizeNavPath(href) === currentPage) {
      a.classList.add('is-active');
    }
  });

  /* ---------- Scroll reveal (e.g. the MISSION section) ----------
     Any .reveal-on-scroll element fades/rises in the first time it enters
     the viewport, then is left alone — this is a one-shot "reveal", not a
     repeating scroll effect, and it's separate from the hero's own
     page-load entrance timeline above. Elements start hidden via CSS; if
     IntersectionObserver isn't available, reveal everything immediately
     rather than leaving content permanently invisible. */
  const revealEls = document.querySelectorAll('.reveal-on-scroll');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      const revealObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.2, rootMargin: '0px 0px -10% 0px' });
      revealEls.forEach(el => revealObserver.observe(el));
    } else {
      revealEls.forEach(el => el.classList.add('is-visible'));
    }
  }

  /* ---------- Article expand (articles.html) ----------
     "Read more" toggles the rest of an in-page article (the hidden
     .article-more block named by aria-controls). Collapsing scrolls the
     article's title back into view so the reader isn't stranded. */
  document.querySelectorAll('.article-toggle').forEach(btn => {
    const more = document.getElementById(btn.getAttribute('aria-controls'));
    if (!more) return;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      more.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
      btn.innerHTML = open ? 'Read more <span aria-hidden="true">&darr;</span>'
                           : 'Show less <span aria-hidden="true">&uarr;</span>';
      if (open) {
        const entry = btn.closest('.article-entry');
        if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* ---------- Film page section nav (film.html) ----------
     All four sections sit on one continuous page. The tab bar sticks under
     the site nav; clicking a tab smoothly scrolls to that section (landing
     just below the pinned bar), and the highlighted tab follows whichever
     section you're reading as you scroll. The old live-action.html /
     claymation.html / screenplays.html / music.html pages forward to
     film.html#<section>, which lands on that section here. */
  const filmTabs = Array.from(document.querySelectorAll('.film-tab'));
  if (filmTabs.length) {
    const sections = filmTabs
      .map(t => document.getElementById(t.getAttribute('href').slice(1)))
      .filter(Boolean);
    const bar = document.querySelector('.film-tabs-bar');
    const nav = document.querySelector('.site-nav');
    const offset = () => (nav ? nav.offsetHeight : 0) + (bar ? bar.offsetHeight : 0);

    const setActive = (id) => {
      filmTabs.forEach(t => {
        const on = t.getAttribute('href') === '#' + id;
        t.classList.toggle('is-active', on);
        if (on) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      });
    };
    const scrollToSection = (id, smooth) => {
      const el = document.getElementById(id);
      if (!el) return;
      const y = window.scrollY + el.getBoundingClientRect().top - offset() + 1;
      window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'instant' });
    };

    // While a click-scroll is in flight, keep the clicked tab highlighted
    // instead of flickering through the sections it passes.
    let lockUntil = 0;
    filmTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const id = tab.getAttribute('href').slice(1);
        setActive(id);
        lockUntil = Date.now() + 900;
        history.replaceState(null, '', '#' + id);
        scrollToSection(id, true);
      });
    });

    // Scroll spy: the active section is the last one whose top has passed
    // just below the pinned bar.
    let ticking = false;
    const spy = () => {
      ticking = false;
      if (Date.now() < lockUntil) return;
      const line = offset() + 40;
      let current = sections[0];
      sections.forEach(sec => { if (sec.getBoundingClientRect().top <= line) current = sec; });
      // at the very bottom of the page, the last section wins
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = sections[sections.length - 1];
      if (current) setActive(current.id);
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
    window.addEventListener('resize', spy);

    // Arriving with a #section in the address (e.g. from the old pages)
    const startId = location.hash.slice(1);
    if (sections.some(sec => sec.id === startId)) {
      setActive(startId);
      lockUntil = Date.now() + 600;
      window.addEventListener('load', () => scrollToSection(startId, false));
      requestAnimationFrame(() => scrollToSection(startId, false));
    } else {
      spy();
    }

    // Banner reel sound toggle
    const bannerMute = document.querySelector('.film-banner-mute');
    const bannerVid = document.querySelector('.film-banner-video');
    if (bannerMute && bannerVid) {
      bannerMute.addEventListener('click', () => {
        bannerVid.muted = !bannerVid.muted;
        if (!bannerVid.muted) bannerVid.play().catch(() => {});
        const on = !bannerVid.muted;
        bannerMute.setAttribute('aria-pressed', String(on));
        bannerMute.setAttribute('aria-label', on ? 'Mute reel' : 'Unmute reel');
        bannerMute.querySelector('.mute-icon')?.classList.toggle('is-on', on);
      });
    }
  }


  /* ---------- Film page: Slideshow viewer (film.html) ----------
     The "Slideshow" tile in the Live Action grid opens the slideshow large
     and centered in #slideshow-modal; ×, Esc or clicking outside closes it. */
  const showModal = document.getElementById('slideshow-modal');
  const showOpeners = document.querySelectorAll('[data-slideshow-open]');
  if (showModal && showOpeners.length) {
    const showEl = showModal.querySelector('.slideshow');
    let lastOpener = null;
    const openShow = (btn) => {
      lastOpener = btn;
      showModal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      showEl?.focus({ preventScroll: true });
    };
    const closeShow = () => {
      if (!showModal.classList.contains('is-open')) return;
      showModal.classList.remove('is-open');
      document.body.style.overflow = '';
      lastOpener?.focus({ preventScroll: true });
    };
    showOpeners.forEach(btn => btn.addEventListener('click', () => openShow(btn)));
    showModal.querySelector('.video-modal-close')?.addEventListener('click', closeShow);
    showModal.addEventListener('click', (e) => { if (e.target === showModal) closeShow(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShow(); });
  }

});
