const MILLENNIUM_IS_CLIENT_MODULE = true;

(() => {
    const plugin = 'launcher-auto-close';
    const settingsKey = 'millennium.launcherAutoClose.v1';
    const providers = {
        epicgameslauncher: {name:'Epic Games', exe:'epicgameslauncher.exe', link:/com\.epicgames\.launcher:/i},
        eadesktop: {name:'EA app', exe:'eadesktop.exe', link:/(?:origin2?|eadm|eaapp|link2ea):\/\//i},
        upc: {name:'Ubisoft Connect', exe:'upc.exe', link:/(?:uplay|ubisoftconnect):\/\//i},
        galaxyclient: {name:'GOG Galaxy', exe:'galaxyclient.exe', link:/goggalaxy:\/\//i},
        battle_net: {name:'Battle.net', exe:'battle.net.exe', link:/battlenet:\/\//i},
    };
    const storage = window.localStorage;
    let delay = Number(storage.getItem(settingsKey + '.delay') ?? 60);
    if (!Number.isInteger(delay) || delay < 0 || delay > 3600) delay = 60;
    let disabled = new Set();
    try { disabled = new Set(JSON.parse(storage.getItem(settingsKey + '.disabled') ?? '[]')); } catch {}
    const entries = new Map();
    const jobs = new Map();
    const subscribers = new Set();
    let polling = false;
    let status = '';

    const executableName = path => path.split(/[\\/]/).pop().toLowerCase();
    const absoluteExe = /^[a-z]:[\\/].+\.exe$/i;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function rpc(method, args = {}) {
        let result = await Millennium.callServerMethod(plugin, method, args);
        for (let i = 0; i < 2 && typeof result === 'string'; i++) result = JSON.parse(result);
        if (result?.error) throw new Error(result.error);
        return result;
    }

    function notify(message) {
        status = message;
        for (const update of subscribers) update(message);
    }

    function runningGames() {
        const apps = window.SteamUIStore?.RunningApps;
        return apps && new Map(Array.from(apps)
            .filter(app => (Number(app.appid) >>> 0) >= 0x80000000)
            .map(app => [String(Number(app.appid) >>> 0), app]));
    }

    function identify(details) {
        const target = (details.strShortcutExe ?? '').trim().replace(/^"(.*)"$/, '$1');
        const options = details.strLaunchOptions ?? '';
        const name = executableName(target);
        const keys = Object.keys(providers).filter(key => {
            const provider = providers[key];
            return provider.exe === name || provider.link.test(target) || provider.link.test(options);
        });
        if (keys.length !== 1) return null;
        const key = keys[0];
        const launcherPath = name === providers[key].exe && absoluteExe.test(target)
            ? target.replaceAll('/', '\\') : '';
        const gameExe = !launcherPath && absoluteExe.test(target)
            && !/^(?:explorer|cmd|powershell|pwsh|wscript|cscript|rundll32|start|.*bootstrapper)\.exe$/i.test(name)
            ? name : '';
        let epicApp = '';
        if (key === 'epicgameslauncher') {
            const uriId = /com\.epicgames\.launcher:\/\/apps\/([^?\s"'\\]+)/i.exec(target + ' ' + options)?.[1];
            if (uriId) {
                try { epicApp = decodeURIComponent(uriId).split(':').pop(); } catch {}
            }
        }
        return {key, launcherPath, gameExe, epicApp};
    }

    async function discover(id, app) {
        const prior = entries.get(id);
        if (prior && (!prior.retryAt || prior.retryAt > Date.now())) return;
        const store = window.appDetailsStore;
        if (!store) return;
        const cached = store.GetAppDetails?.(Number(id));
        const details = cached ?? await Promise.race([
            store.RequestAppDetails(Number(id)),
            wait(2000).then(() => null),
        ]);
        if (!details) {
            entries.set(id, {retryAt:Date.now() + 5000, pending:true});
            return;
        }
        const match = identify(details);
        if (!match) {
            entries.set(id, {retryAt:Date.now() + 30000});
            return;
        }
        const {key, launcherPath, epicApp} = match;
        const folder = epicApp
            ? (await rpc('LauncherEpicInstall', {payload:JSON.stringify({app:epicApp})})).folder ?? '' : '';
        const exe = key === 'epicgameslauncher' && app.display_name?.trim().toLowerCase() === 'fortnite'
            ? 'fortniteclient-win64-shipping.exe' : match.gameExe;
        entries.set(id, {key, launcherPath, exe, folder, seenProcess:false});
    }
    function activeLaunchers(running, processes) {
        const active = new Map();
        for (const [id, entry] of entries) {
            if (!entry.key || disabled.has(entry.key)) continue;
            const steamRunning = running.has(id);
            const processRunning = !!(processes[entry.folder] || processes[entry.exe]);
            if (processRunning && (steamRunning || jobs.has(entry.key))) entry.seenProcess = true;
            if (!steamRunning && !processRunning) entry.seenProcess = false;
            if ((processRunning && (steamRunning || jobs.has(entry.key))) || (steamRunning && !entry.seenProcess)) {
                active.set(entry.key, entry.launcherPath || active.get(entry.key) || '');
            }
        }
        return active;
    }
    async function closeLauncher(key, job, active) {
        const now = Date.now();
        if (active.has(key)) {
            job.idleSince = null;
            job.finishAt = null;
            return;
        }
        job.idleSince ??= now;
        const finishing = job.finishAt !== null;
        if (now < (finishing ? job.finishAt : job.idleSince + delay * 1000)) return;
        const resolved = await rpc('LauncherResolve', {payload:JSON.stringify({key})});
        const path = resolved.path || job.launcherPath;
        const latest = runningGames();
        if (jobs.get(key) !== job || !latest) return;
        if ([...latest.keys()].some(id => {
            const entry = entries.get(id);
            return !entry || entry.pending || (entry.key === key && !entry.seenProcess);
        })) return;
        if (!path) {
            jobs.delete(key);
            return;
        }
        const result = await rpc('LauncherClose', {
            payload:JSON.stringify({path, finishLauncher:finishing}),
        });
        if (!finishing) {
            job.finishAt = Date.now() + (result.windows ? 5000 : 0);
        } else {
            jobs.delete(key);
            if (result.terminated) notify(providers[key].name + ' cerrado.');
        }
    }

    async function poll() {
        const observed = runningGames();
        if (polling || !observed) return;
        polling = true;
        try {
            await Promise.all([...observed].map(([id, app]) => discover(id, app)));
            if (!jobs.size && !observed.size) return;
            const tracked = [...entries].filter(([id, entry]) =>
                (observed.has(id) || jobs.has(entry.key)) && (entry.folder || entry.exe));
            const folders = [...new Set(tracked.map(([, entry]) => entry.folder).filter(Boolean))];
            const processes = tracked.length
                ? await rpc('LauncherRunningExecutables', {payload:JSON.stringify({folders})}) : {};
            const current = runningGames();
            if (!current) return;
            const active = activeLaunchers(current, processes);
            for (const [key, launcherPath] of active) {
                const job = jobs.get(key) ?? {idleSince:null, finishAt:null, launcherPath:''};
                job.launcherPath = launcherPath || job.launcherPath;
                jobs.set(key, job);
            }
            for (const [key, job] of jobs) {
                try { await closeLauncher(key, job, active); }
                catch (error) {
                    jobs.delete(key);
                    notify(providers[key].name + ': ' + error.message);
                }
            }
        } catch (error) {
            notify('Cierre automático: ' + error.message);
        } finally {
            polling = false;
        }
    }

    function Settings() {
        const React = window.SP_REACT;
        const h = React.createElement;
        const [seconds, setSeconds] = React.useState(delay);
        const [excluded, setExcluded] = React.useState(disabled);
        const [message, setMessage] = React.useState(status);
        React.useEffect(() => {
            subscribers.add(setMessage);
            return () => subscribers.delete(setMessage);
        }, []);

        function changeDelay(value) {
            storage.setItem(settingsKey + '.delay', String(value));
            delay = value;
            setSeconds(value);
        }

        function toggle(key, enabled) {
            const next = new Set(disabled);
            if (enabled) next.delete(key);
            else next.add(key);
            storage.setItem(settingsKey + '.disabled', JSON.stringify([...next]));
            disabled = next;
            if (enabled) {
                for (const [id, entry] of entries) if (entry.key === key) entries.delete(id);
            } else {
                jobs.delete(key);
            }
            setExcluded(next);
        }

        return h('div', {className:'elac'},
            h('style', null, '.elac{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;width:100%;max-width:100%;min-width:0;padding:12px;box-sizing:border-box;color:inherit;font:inherit;overflow-wrap:anywhere}.elac *{box-sizing:border-box;min-width:0}.elac section{display:grid;gap:9px;padding:11px;background:#202b38;border:1px solid #35485b;border-radius:6px}.elac .elac-line,.elac .elac-presets{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.elac .elac-line{justify-content:space-between}.elac .elac-range{display:grid;gap:7px}.elac .elac-range input{margin:0;width:100%;max-width:100%;accent-color:#8fd5fa}.elac button{border:1px solid #506174;background:#2c3b4b;color:#eef6ff;border-radius:4px;padding:4px 8px;font:inherit;cursor:pointer}.elac button[aria-pressed=true]{background:#9ad6fb;color:#122637;border-color:transparent}.elac .elac-client{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #35485b;padding-top:7px}.elac .elac-client input{margin:0;flex:none;accent-color:#8fd5fa}.elac p{margin:0;font-size:12px}'),
            h('section', null,
                h('label', {className:'elac-range'},
                    h('span', {className:'elac-line'}, h('strong', null, 'Espera para cerrar'),
                        h('output', null, seconds + ' s')),
                    h('input', {type:'range', min:0, max:Math.max(600, seconds), step:1, value:seconds,
                        'aria-valuetext':seconds + ' segundos', onChange:e=>changeDelay(Number(e.target.value))})),
                h('div', {className:'elac-presets'}, ...[30,60,120,300].map(value =>
                    h('button', {key:value, type:'button', 'aria-pressed':seconds === value,
                        onClick:()=>changeDelay(value)}, value + ' s')))),
            h('section', null,
                h('strong', null, 'Cerrar automáticamente'),
                ...Object.entries(providers).map(([key, {name}]) =>
                    h('label', {className:'elac-client', key}, name,
                        h('input', {type:'checkbox', checked:!excluded.has(key),
                            onChange:e=>toggle(key, e.target.checked)})))),
            message && h('p', {role:'status'}, message));
    }
    const key = '__millenniumLauncherAutoCloseTimer';
    clearInterval(window[key]);
    window[key] = setInterval(poll, 2000);
    (window.PLUGIN_LIST ??= {})[plugin] = {__millennium_internal_plugin_name_do_not_use_or_change__:plugin};
    const h = window.SP_REACT.createElement;
    (window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS ??= {})[plugin] = {
        title:'ExternalLauncherAutoClose', icon:h('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'currentColor','aria-hidden':true},
            h('path',{d:'M19.43 12.98a7.9 7.9 0 0 0 0-1.96l2.11-1.65-2-3.46-2.49 1a7.8 7.8 0 0 0-1.69-.98L15 3h-4l-.36 2.93c-.61.25-1.17.58-1.69.98l-2.49-1-2 3.46 2.11 1.65a7.9 7.9 0 0 0 0 1.96l-2.11 1.65 2 3.46 2.49-1c.52.4 1.08.73 1.69.98L11 21h4l.36-2.93c.61-.25 1.17-.58 1.69-.98l2.49 1 2-3.46-2.11-1.65ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z'})), content:h(Settings),
    };
    MILLENNIUM_BACKEND_IPC.postMessage(1,{pluginName:plugin});
})();
