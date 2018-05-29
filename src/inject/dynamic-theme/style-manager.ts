import {iterateCSSRules, iterateCSSDeclarations, replaceCSSRelativeURLsWithAbsolute, replaceCSSFontFace, replaceCSSVariables, getCSSURLValue, cssImportRegex} from './css-rules';
import {getModifiableCSSDeclaration, getModifiedFallbackStyle, ModifiableCSSDeclaration, ModifiableCSSRule} from './modify-css';
import {bgFetch} from './network';
import {removeNode} from '../utils/dom';
import {throttle} from '../utils/throttle';
import {logWarn} from '../utils/log';
import {getMatches} from '../../utils/text';
import {FilterConfig} from '../../definitions';

declare global {
    interface HTMLStyleElement {
        sheet: CSSStyleSheet;
    }
    interface HTMLLinkElement {
        sheet: CSSStyleSheet;
    }
}

export interface StyleManager {
    details(): {variables: Map<string, string>};
    render(filter: FilterConfig, variables: Map<string, string>): void;
    pause(): void;
    destroy(): void;
}

export const STYLE_SELECTOR = 'link[rel="stylesheet" i], style';

export function shouldManageStyle(element: Node) {
    return (
        (
            (element instanceof HTMLStyleElement) ||
            (element instanceof HTMLLinkElement && element.rel && element.rel.toLowerCase() === 'stylesheet')
        ) && (
            !element.classList.contains('darkreader') ||
            element.classList.contains('darkreader--cors')
        ) &&
        element.media !== 'print'
    );
}

export async function manageStyle(element: HTMLLinkElement | HTMLStyleElement, {update, loadingStart, loadingEnd}): Promise<StyleManager> {

    const prevStyles: HTMLStyleElement[] = [];
    let next: Element = element;
    while ((next = next.nextElementSibling) && next.matches('.darkreader')) {
        prevStyles.push(next as HTMLStyleElement);
    }
    let corsCopy: HTMLStyleElement = prevStyles.find((el) => el.matches('.darkreader--cors')) || null;
    let syncStyle: HTMLStyleElement = prevStyles.find((el) => el.matches('.darkreader--sync')) || null;
    const asyncStyles: HTMLStyleElement[] = prevStyles.filter((el) => el.matches('.darkreader--async')); // Still need to remove async style used by prev version

    let cancelAsyncOperations = false;

    function isCancelled() {
        return cancelAsyncOperations;
    }

    const observer = new MutationObserver(async (mutations) => {
        rules = await getRules();
        update();
    });
    const observerOptions: MutationObserverInit = {attributes: true, childList: true};

    let rules: CSSRuleList;

    async function getRules() {
        let rules: CSSRuleList = null;
        if (element.sheet == null) {
            if (element instanceof HTMLLinkElement) {
                await linkLoading(element);
                if (cancelAsyncOperations) {
                    return null;
                }
            } else {
                return null;
            }
        }
        try {
            rules = element.sheet.cssRules;
        } catch (err) {
            // Sometimes cross-origin stylesheets are protected from direct access
            // so need to load CSS text and insert it into style element
            const link = element as HTMLLinkElement;
            if (corsCopy) {
                corsCopy.disabled = false;
                rules = corsCopy.sheet.cssRules;
                corsCopy.disabled = true;
            } else {
                loadingStart();
                try {
                    corsCopy = await createCORSCopy(link, isCancelled);
                } catch (err) {
                    logWarn(err);
                }
                loadingEnd();
                if (corsCopy) {
                    corsCopy.disabled = false;
                    rules = corsCopy.sheet.cssRules;
                    corsCopy.disabled = true;
                }
            }
        }
        return rules;
    }

    function getVariables() {
        const variables = new Map<string, string>();
        rules && iterateCSSRules(rules, (rule) => {
            rule.style && iterateCSSDeclarations(rule.style, (property, value) => {
                if (property.startsWith('--')) {
                    variables.set(property, value);
                }
            });
        });
        return variables;
    }

    function details() {
        const variables = getVariables();
        return {variables};
    }

    function getFilterKey(filter: FilterConfig) {
        return ['mode', 'brightness', 'contrast', 'grayscale', 'sepia'].map((p) => `${p}:${filter[p]}`).join(';');
    }

    let renderId = 0;
    const rulesTextCache = new Map<string, string>();
    const rulesModCache = new Map<string, ModifiableCSSRule>();
    let prevFilterKey: string = null;

    async function render(filter: FilterConfig, variables: Map<string, string>) {
        rules = await getRules();
        if (!rules) {
            return null;
        }
        cancelAsyncOperations = false;
        let rulesChanged = (rulesModCache.size === 0);
        const notFoundCacheKeys = new Set(rulesModCache.keys());
        const filterKey = getFilterKey(filter);
        let filterChanged = (filterKey !== prevFilterKey);

        const modRules: ModifiableCSSRule[] = [];
        iterateCSSRules(rules, (rule) => {
            let cssText = rule.cssText;
            let textDiffersFromPrev = false;

            notFoundCacheKeys.delete(cssText);
            if (!rulesTextCache.has(cssText)) {
                rulesTextCache.set(cssText, cssText);
                textDiffersFromPrev = true;
            }

            // Put CSS text with inserted CSS variables into separate <style> element
            // to properly handle composite properties (e.g. background -> background-color)
            let vars: HTMLStyleElement = null;
            let varsRule: CSSStyleRule = null;
            if (variables.size > 0) {
                const cssTextWithVariables = replaceCSSVariables(cssText, variables);
                if (rulesTextCache.get(cssText) !== cssTextWithVariables) {
                    rulesTextCache.set(cssText, cssTextWithVariables);
                    textDiffersFromPrev = true;
                    vars = document.createElement('style');
                    vars.classList.add('darkreader');
                    vars.classList.add('darkreader--vars');
                    vars.media = 'screen';
                    vars.textContent = cssTextWithVariables;
                    element.parentElement.insertBefore(vars, element.nextSibling);
                    varsRule = (vars.sheet as CSSStyleSheet).cssRules[0] as CSSStyleRule;
                }
            }

            if (textDiffersFromPrev) {
                rulesChanged = true;
            } else {
                modRules.push(rulesModCache.get(cssText));
                return;
            }

            const modDecs: ModifiableCSSDeclaration[] = [];
            const targetRule = varsRule || rule;
            targetRule && targetRule.style && iterateCSSDeclarations(targetRule.style, (property, value) => {
                const mod = getModifiableCSSDeclaration(property, value, rule, isCancelled);
                if (mod) {
                    modDecs.push(mod);
                }
            });

            let modRule: ModifiableCSSRule = null;
            if (modDecs.length > 0) {
                modRule = {selector: rule.selectorText, declarations: modDecs};
                if (rule.parentRule instanceof CSSMediaRule) {
                    modRule.media = (rule.parentRule as CSSMediaRule).media.mediaText;
                }
                modRules.push(modRule);
            }
            rulesModCache.set(cssText, modRule);

            removeNode(vars);
        });

        notFoundCacheKeys.forEach((key) => {
            rulesTextCache.delete(key);
            rulesModCache.delete(key);
        });
        prevFilterKey = filterKey;

        if (!rulesChanged && !filterChanged) {
            return;
        }

        renderId++;

        asyncStyles.forEach(removeNode);
        asyncStyles.splice(0);

        interface ReadyDeclaration {
            media: string;
            selector: string;
            property: string;
            value: string;
            important: boolean;
        }

        const readyDeclarations: ReadyDeclaration[] = [];

        function buildStyleSheet() {
            const groups: ReadyDeclaration[][] = [];
            readyDeclarations.filter((d) => d).forEach((decl) => {
                let group: ReadyDeclaration[];
                const prev = groups.length > 0 ? groups[groups.length - 1] : null;
                if (prev && prev[0].selector === decl.selector && prev[0].media === decl.media) {
                    group = prev;
                } else {
                    group = [];
                    groups.push(group);
                }
                group.push(decl);
            });

            const lines: string[] = [];
            groups.forEach((group) => {
                const {media, selector} = group[0];
                if (media) {
                    lines.push(`@media ${media} {`);
                }
                lines.push(`${selector} {`);
                group.forEach(({property, value, important}) => {
                    lines.push(`    ${property}: ${value}${important ? ' !important' : ''};`);
                });
                lines.push('}');
                if (media) {
                    lines.push('}')
                }
            });

            if (!syncStyle) {
                syncStyle = document.createElement('style');
                syncStyle.classList.add('darkreader');
                syncStyle.classList.add('darkreader--sync');
                syncStyle.media = 'screen';
            }
            element.parentElement.insertBefore(syncStyle, corsCopy ? corsCopy.nextSibling : element.nextSibling);
            syncStyle.textContent = lines.join('\n');
        }

        const RULES_PER_MS = 100;
        const REQUESTED_RESOURCES = 1 / 4;
        const declarationsCount = modRules.filter((r) => r).reduce((total, {declarations}) => total + declarations.length, 0);
        const timeout = declarationsCount / RULES_PER_MS / REQUESTED_RESOURCES;

        const throttledBuildStyleSheet = throttle((currentRenderId: number) => {
            if (cancelAsyncOperations || renderId !== currentRenderId) {
                return;
            }
            buildStyleSheet();
        }, timeout);

        modRules.filter((r) => r).forEach(({selector, declarations, media}) => {
            declarations.forEach(({property, value, important}) => {
                if (typeof value === 'function') {
                    const modified = value(filter);
                    if (modified instanceof Promise) {
                        const index = readyDeclarations.length;
                        readyDeclarations.push(null);
                        const promise = modified;
                        const currentRenderId = renderId;
                        promise.then((asyncValue) => {
                            if (!asyncValue || cancelAsyncOperations || currentRenderId !== renderId) {
                                return;
                            }
                            readyDeclarations[index] = {media, selector, property, value: asyncValue, important};
                            throttledBuildStyleSheet(currentRenderId);
                        });
                    } else {
                        readyDeclarations.push({media, selector, property, value: modified, important});
                    }
                } else {
                    readyDeclarations.push({media, selector, property, value, important});
                }
            });
        });

        throttledBuildStyleSheet(renderId);

        observer.observe(element, observerOptions);

        if (element instanceof HTMLStyleElement && element.hasAttribute('data-styled-components')) {
            if (element.sheet && element.sheet.cssRules) {
                styledComponentsRulesCount = element.sheet.cssRules.length;
            }
            cancelAnimationFrame(styledComponentsCheckFrameId);
            styledComponentsChecksCount = 0;
            const checkForUpdate = async () => {
                if (element.sheet && element.sheet.cssRules &&
                    element.sheet.cssRules.length !== styledComponentsRulesCount
                ) {
                    logWarn('CSS Rules count changed', element);
                    cancelAnimationFrame(styledComponentsCheckFrameId);
                    rules = await getRules();
                    update();
                    return;
                }
                styledComponentsChecksCount++;
                if (styledComponentsChecksCount === 1000) {
                    cancelAnimationFrame(styledComponentsCheckFrameId);
                    return;
                }
                styledComponentsCheckFrameId = requestAnimationFrame(checkForUpdate);
            };
            checkForUpdate();
        }
    }

    let styledComponentsRulesCount: number = null;
    let styledComponentsChecksCount: number = null;
    let styledComponentsCheckFrameId: number = null;

    function pause() {
        observer.disconnect();
        cancelAsyncOperations = true;
        cancelAnimationFrame(styledComponentsCheckFrameId);
    }

    function destroy() {
        pause();
        removeNode(corsCopy);
        removeNode(syncStyle);
        asyncStyles.forEach(removeNode);
    }

    observer.observe(element, observerOptions);
    rules = await getRules();

    return {
        details,
        render,
        pause,
        destroy,
    };
}

function linkLoading(link: HTMLLinkElement) {
    return new Promise<void>((resolve, reject) => {
        const cleanUp = () => {
            link.removeEventListener('load', onLoad);
            link.removeEventListener('error', onError);
        }
        const onLoad = () => {
            cleanUp();
            resolve();
        };
        const onError = () => {
            cleanUp();
            reject(`Link loading failed ${link.href}`);
        };
        link.addEventListener('load', onLoad);
        link.addEventListener('error', onError);
    });
}

async function loadCSSText(url: string) {
    let response: string;
    let cache: string;
    try {
        cache = sessionStorage.getItem(`darkreader-cache:${url}`);
    } catch (err) {
        logWarn(err);
    }
    if (cache) {
        response = cache;
    } else {
        response = await bgFetch({url, responseType: 'text'});
        if (response.length < 2 * 1024 * 1024) {
            try {
                sessionStorage.setItem(`darkreader-cache:${url}`, response);
            } catch (err) {
                logWarn(err);
            }
        }
    }

    let cssText = response;
    cssText = replaceCSSFontFace(cssText);
    cssText = replaceCSSRelativeURLsWithAbsolute(cssText, url);

    const importMatches = getMatches(cssImportRegex, cssText);
    for (let match of importMatches) {
        const importURL = getCSSURLValue(match.substring(8).replace(/;$/, ''));
        const importedCSS = await loadCSSText(importURL);
        cssText = cssText.split(match).join(importedCSS);
    }

    cssText = cssText.trim();

    return cssText;
}

async function createCORSCopy(link: HTMLLinkElement, isCancelled: () => boolean) {
    const url = link.href;
    const prevCors = Array.from<HTMLStyleElement>(link.parentElement.querySelectorAll('.darkreader--cors')).find((el) => el.dataset.uri === url);
    if (prevCors) {
        return prevCors;
    }

    const cssText = await loadCSSText(url);
    if (!cssText) {
        return null;
    }

    const cors = document.createElement('style');
    cors.classList.add('darkreader');
    cors.classList.add('darkreader--cors');
    cors.media = 'screen';
    cors.dataset.uri = url;
    cors.textContent = cssText;
    link.parentElement.insertBefore(cors, link.nextSibling);

    return cors;
}
