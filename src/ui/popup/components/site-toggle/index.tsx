import {html, render} from 'malevic';
import {Button} from '../../../controls';
import {getURLHost} from '../../../../utils/url';
import {getLocalMessage} from '../../../../utils/locales';
import {ExtWrapper, TabInfo} from '../../../../definitions';

export default function SiteToggleButton({data, tab, actions}: ExtWrapper & {tab: TabInfo}) {
    const toggleHasEffect = (
        data.enabled &&
        !tab.isProtected &&
        (data.filterConfig.invertListed || !tab.isInDarkList)
    );

    const host = getURLHost(tab.url || '');

    const urlText = (host
        ? host
            .split('.')
            .reduce((elements, part, i) => elements.concat(
                <wbr />,
                `${i > 0 ? '.' : ''}${part}`
            ), [])
        : 'current site');

    return (
        <Button
            class={{
                'site-toggle': true,
                'site-toggle--disabled': !toggleHasEffect
            }}
            onclick={() => actions.toggleSitePattern(host)}
        >
            {getLocalMessage('toggle')} <span class="site-toggle__url" >{urlText}</span>
        </Button>
    );
}
