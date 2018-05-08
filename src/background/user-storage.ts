import {isMacOS, isWindows} from '../utils/platform';
import ThemeEngines from '../generators/theme-engines';
import {UserSettings, FilterConfig} from '../definitions';

const SAVE_TIMEOUT = 1000;

export default class UserStorage {
    private defaultSettings: UserSettings;

    constructor() {
        this.defaultSettings = {
            enabled: true,
            config: {
                mode: 1,
                brightness: 100,
                contrast: 90,
                grayscale: 0,
                sepia: 10,
                useFont: false,
                fontFamily: isMacOS() ? 'Helvetica Neue' : isWindows() ? 'Segoe UI' : 'Open Sans',
                textStroke: 0,
                invertListed: false,
                engine: ThemeEngines.dynamicTheme,
                siteList: [],
                custom: [],
                changeBrowserTheme: false,
            },
        };
    }
    loadSettings() {
        return new Promise<UserSettings>((resolve) => {
            chrome.storage.sync.get(this.defaultSettings, ($s: UserSettings) => {
                $s.config = {...this.defaultSettings.config, ...$s.config};
                if (!Array.isArray($s.config.siteList)) {
                    const arr = [];
                    for (let key in $s.config.siteList) {
                        arr[key] = $s.config.siteList[key];
                    }
                    $s.config.siteList = arr;
                }
                resolve({
                    enabled: $s.enabled,
                    config: $s.config,
                } as UserSettings);
            });
        });
    }

    saveSetting(settings: UserSettings) {
        if (this.timeout) {
            clearInterval(this.timeout);
        }
        return new Promise<UserSettings>((resolve) => {
            this.timeout = setTimeout(() => {
                const $s: UserSettings = {
                    enabled: settings.enabled,
                    config: settings.config,
                };
                chrome.storage.sync.set($s, () => {
                    this.timeout = null;
                    resolve($s);
                });
            }, SAVE_TIMEOUT);
        });
    }

    private timeout: number = null;
}
