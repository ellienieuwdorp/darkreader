import {replaceCSSVariables} from './css-rules';
import {getModifiedUserAgentStyle, cleanModificationCache} from './modify-css';
import manageStyle, {StyleManager} from './style-manager';
import {removeNode} from '../utils/dom';
import {createTextStyle} from '../../generators/text-style';
import {FilterConfig} from '../../definitions';

const styleManagers = new Map<HTMLLinkElement | HTMLStyleElement, StyleManager>();
const variables = new Map<string, string>();
let filter: FilterConfig = null;

function createOrUpdateStyle(className: string) {
    let style = document.head.querySelector(`.${className}`) as HTMLStyleElement;
    if (!style) {
        style = document.createElement('style');
        style.classList.add('darkreader');
        style.classList.add(className);
        style.media = 'screen';
    }
    return style;
}

function createTheme() {
    const userAgentStyle = createOrUpdateStyle('darkreader--user-agent');
    document.head.insertBefore(userAgentStyle, document.head.firstChild);
    userAgentStyle.textContent = getModifiedUserAgentStyle(filter);

    const textStyle = createOrUpdateStyle('darkreader--text');
    document.head.insertBefore(textStyle, userAgentStyle.nextSibling);
    if (filter.useFont || filter.textStroke > 0) {
        textStyle.textContent = createTextStyle(filter);
    } else {
        textStyle.textContent = '';
    }

    Array.from<HTMLLinkElement | HTMLStyleElement>(document.querySelectorAll('link[rel="stylesheet"], style'))
        .filter((style) => !styleManagers.has(style) && shouldManageStyle(style))
        .forEach((style) => createManager(style));

    throttledRender();
}

const pendingCreation = new Set<HTMLLinkElement | HTMLStyleElement>();

async function createManager(element: HTMLLinkElement | HTMLStyleElement) {
    if (styleManagers.has(element) || pendingCreation.has(element)) {
        return;
    }
    pendingCreation.add(element);

    function update() {
        const details = manager.details();
        updateVariables(details.variables);
        throttledRender();
    }

    const manager = await manageStyle(element, {update});
    if (!pendingCreation.has(element)) {
        manager.destroy();
        return;
    }
    styleManagers.set(element, manager);
    update();
}

function updateVariables(newVars: Map<string, string>) {
    newVars.forEach((value, key) => variables.set(key, value));
    variables.forEach((value, key) => variables.set(key, replaceCSSVariables(value, variables)));
}

function removeManager(element: HTMLLinkElement | HTMLStyleElement) {
    const manager = styleManagers.get(element);
    if (manager) {
        manager.destroy();
        styleManagers.delete(element);
    }
}

let pendingRendering = false;
let requestedFrameId: number = null;

function render() {
    styleManagers.forEach((manager) => manager.render(filter, variables));
}

function throttledRender() {
    if (requestedFrameId) {
        pendingRendering = true;
    } else {
        render();
        requestedFrameId = requestAnimationFrame(() => {
            requestedFrameId = null;
            if (pendingRendering) {
                render();
                pendingRendering = false;
            }
        });
    }
}

function shouldManageStyle(element: Node) {
    return (
        (
            (element instanceof HTMLStyleElement) ||
            (element instanceof HTMLLinkElement && element.rel === 'stylesheet')
        ) && (
            !element.classList.contains('darkreader') ||
            element.classList.contains('darkreader--cors')
        )
    );
}

let styleChangeObserver: MutationObserver = null;

function createThemeAndWatchForUpdates() {
    createTheme();
    styleChangeObserver = new MutationObserver((mutations) => {
        const addedStyles = mutations.reduce((nodes, m) => nodes.concat(Array.from(m.addedNodes).filter(shouldManageStyle)), []);
        addedStyles.forEach((el) => createManager(el));
        const removedStyles = mutations.reduce((nodes, m) => nodes.concat(Array.from(m.removedNodes).filter(shouldManageStyle)), []);
        removedStyles.forEach((el) => removeManager(el));
        if (
            (addedStyles.length + removedStyles.length > 0) ||
            mutations.some((m) => m.target && shouldManageStyle(m.target))
        ) {
            throttledRender();
        }
    });
    styleChangeObserver.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
    document.addEventListener('load', throttledRender);
    window.addEventListener('load', throttledRender);
}

function stopWatchingForUpdates() {
    styleManagers.forEach((manager) => manager.pause());
    if (styleChangeObserver) {
        styleChangeObserver.disconnect();
        styleChangeObserver = null;
    }
    document.removeEventListener('load', throttledRender);
    window.removeEventListener('load', throttledRender);
}

export function createOrUpdateDynamicTheme(filterConfig: FilterConfig) {
    filter = filterConfig;
    if (document.head) {
        createThemeAndWatchForUpdates();
    } else {
        const headObserver = new MutationObserver(() => {
            if (document.head) {
                headObserver.disconnect();
                createThemeAndWatchForUpdates();
            }
        });
        headObserver.observe(document, {childList: true, subtree: true});
    }
}

export function removeDynamicTheme() {
    cleanDynamicThemeCache();
    removeNode(document.head.querySelector('.darkreader--user-agent'));
    removeNode(document.head.querySelector('.darkreader--text'));
    Array.from(styleManagers.keys()).forEach((el) => removeManager(el));
    Array.from(document.querySelectorAll('.darkreader')).forEach(removeNode);
}

export function cleanDynamicThemeCache() {
    cancelAnimationFrame(requestedFrameId);
    pendingRendering = false;
    requestedFrameId = null;
    pendingCreation.clear();
    stopWatchingForUpdates();
    cleanModificationCache();
}
