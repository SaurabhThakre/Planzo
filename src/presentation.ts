const art = '.coast:not(.destination-cover .coast, .sample-preview .coast), .destination-cover, .help-hero-art, .help-figure, .sample-preview';
const titles = '.page-heading > h1, .page-heading > p, .trip-workspace-header h1, .trip-workspace-header dl > div, .help-intro h1, .hero h2';
const timelines = '.personal-journey > li, .stop-summary > li, .itinerary-timeline > li, .final-journey > li, .history-event, .milestone-list > li';
const staggered = '.benefits > .feature, .trip-list-item, .member-row, .walkthrough-steps > li, .help-shared-path > div, .help-visual-stage, .decision-option, .stop-summary > li, .trip-workspace-header dl > div';
const sections = '.personal-journey, .help-flow-figure, .help-flow-label, .help-article-heading, .illustrative-route, .booking-task, .provider-link, .conversation-progress, main .card > h2, main .card-title-row';
const revealTargets = [art, titles, timelines, staggered, sections].join(', ');

export function observePresentation(root: HTMLElement) {
    const page = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const revealed = new WeakSet<Element>();
    const reading = new Set<Element>();
    let current: Element | undefined;
    let header: HTMLElement | null = null;
    const activeTransitions = new Map<Element, Animation>();

    const updateHeaderHeight = () => {
        const height = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
        page.style.setProperty('--planzo-header-height', height + 'px');
    };
    const headerSize = new ResizeObserver(updateHeaderHeight);
    const updateHeader = () => {
        const next = root.querySelector<HTMLElement>(':scope > .topbar');
        if (next === header) return;
        headerSize.disconnect();
        header = next;
        if (header) headerSize.observe(header);
        updateHeaderHeight();
    };
    const updateScroll = () => {
        page.toggleAttribute('data-planzo-scrolled', window.scrollY > 4);
    };

    const reveals = new IntersectionObserver(entries => {
        for (const { target, isIntersecting } of entries) {
            if (!isIntersecting || !target.isConnected) continue;
            reveals.unobserve(target);
            revealed.add(target);
            if (target.contains(document.activeElement)) continue;
            const kind = target.matches(art) ? 'art' : target.matches(titles) ? 'title' : 'item';
            if (target instanceof HTMLElement && target.parentElement && target.matches(staggered)) {
                const index = Array.from(target.parentElement.children).indexOf(target);
                target.style.setProperty('--planzo-enter-delay', Math.min(index, 3) * 58 + 'ms');
            }
            target.setAttribute('data-planzo-enter', kind);
        }
    }, { rootMargin: '-76px 0px -18px', threshold: 0 });

    const updateReading = () => {
        let closest: Element | undefined;
        let distance = Infinity;
        for (const element of reading) {
            if (!element.isConnected) continue;
            const rect = element.getBoundingClientRect();
            const nextDistance = Math.abs(rect.top + rect.height / 2 - window.innerHeight * .45);
            if (nextDistance < distance) {
                closest = element;
                distance = nextDistance;
            }
        }
        if (closest === current) return;
        current?.removeAttribute('data-planzo-reading');
        closest?.setAttribute('data-planzo-reading', '');
        current = closest;
    };
    const timeline = new IntersectionObserver(entries => {
        for (const { target, isIntersecting } of entries) {
            if (isIntersecting && target.isConnected) reading.add(target);
            else reading.delete(target);
        }
        updateReading();
    }, { rootMargin: '-96px 0px -90px', threshold: 0 });

    const visit = (element: Element, selector: string, apply: (match: Element) => void) => {
        if (element.matches(selector)) apply(element);
        element.querySelectorAll(selector).forEach(apply);
    };
    const watch = (element: Element) => {
        if (reduced.matches || !element.isConnected) return;
        visit(element, revealTargets, target => {
            if (!revealed.has(target)) reveals.observe(target);
        });
        visit(element, timelines, target => timeline.observe(target));
    };
    const unwatch = (element: Element) => {
        visit(element, revealTargets, target => reveals.unobserve(target));
        visit(element, timelines, target => {
            timeline.unobserve(target);
            reading.delete(target);
        });
    };
    const transitionDays = (records: MutationRecord[]) => {
        if (reduced.matches) return;
        for (const record of records) {
            if (record.type !== 'attributes' || record.oldValue !== 'false') continue;
            const selected = record.target;
            if (!(selected instanceof HTMLElement) || !selected.matches('.day-tabs > [aria-selected="true"]')) continue;
            const tabs = selected.parentElement;
            const panel = tabs?.nextElementSibling;
            if (!panel?.matches('.day-panel') || panel.contains(document.activeElement)) continue;
            const previous = records.find(change => change.type === 'attributes' &&
                change.oldValue === 'true' && (change.target as Element).parentElement === tabs)?.target;
            if (!previous) continue;
            const distance = previous.compareDocumentPosition(selected) & Node.DOCUMENT_POSITION_FOLLOWING ? 16 : -16;
            activeTransitions.get(panel)?.cancel();
            const animation = panel.animate(
                [{ opacity: .45, transform: 'translateX(' + distance + 'px)' }, { opacity: 1, transform: 'none' }],
                { duration: 365, easing: 'cubic-bezier(.22, 1, .36, 1)' },
            );
            activeTransitions.set(panel, animation);
            const clear = () => { if (activeTransitions.get(panel) === animation) activeTransitions.delete(panel); };
            void animation.finished.then(clear, clear);
        }
    };
    const content = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.removedNodes) {
                if (node instanceof Element && !root.contains(node)) unwatch(node);
            }
        }
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node instanceof Element) watch(node);
            }
        }
        updateHeader();
        updateReading();
        transitionDays(records);
    });
    const cancelTransitions = () => {
        activeTransitions.forEach(animation => animation.cancel());
        activeTransitions.clear();
    };
    const updatePreference = () => {
        if (!reduced.matches) {
            watch(root);
            return;
        }
        reveals.disconnect();
        timeline.disconnect();
        cancelTransitions();
        reading.clear();
        updateReading();
        root.querySelectorAll('[data-planzo-enter]').forEach(element => {
            element.removeAttribute('data-planzo-enter');
        });
    };

    updateHeader();
    updateScroll();
    watch(root);
    content.observe(root, { childList: true, subtree: true, attributeFilter: ['aria-selected'], attributeOldValue: true });
    reduced.addEventListener('change', updatePreference);
    window.addEventListener('scroll', updateScroll, { passive: true });
    return () => {
        content.disconnect();
        headerSize.disconnect();
        reveals.disconnect();
        timeline.disconnect();
        cancelTransitions();
        reduced.removeEventListener('change', updatePreference);
        window.removeEventListener('scroll', updateScroll);
        current?.removeAttribute('data-planzo-reading');
        page.style.removeProperty('--planzo-header-height');
        page.removeAttribute('data-planzo-scrolled');
    };
}
