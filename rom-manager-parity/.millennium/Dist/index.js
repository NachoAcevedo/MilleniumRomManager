const MILLENNIUM_IS_CLIENT_MODULE = true;

(() => {
    const plugin = 'rom-manager-parity';
    const labels = new Set(["Agregar un producto que no es de Steam","Agregar un producto que no es de Steam...","Agregar un producto que no es de Steam a mi biblioteca...","Add a Non-Steam Game","Add a Non-Steam Game...","Add a Non-Steam Game to My Library..."]);
    const documents = new WeakSet();
    let launching = false;
    const decode = value => {
        if (typeof value === 'string' && value.startsWith('"')) {
            try { return JSON.parse(value); } catch {}
        }
        return value;
    };

    function showLoading(doc) {
        const message = doc.createElement('div');
        Object.assign(message.style, {
            position: 'fixed', inset: '0', display: 'grid', placeItems: 'center',
            zIndex: '2147483647', pointerEvents: 'none',
        });
        const shadow = message.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
          <style>
            .window {
              box-sizing: border-box;
              width: min(var(--width, 1024px), 100vw);
              height: min(var(--height, 600px), 100vh);
              display: grid;
              grid-template: 27px minmax(0, 1fr) / minmax(150px, 20%) minmax(0, 1fr);
              overflow: hidden;
              background: #151b25;
              color: #e8edf6;
              border: 1px solid #47617a;
              border-radius: 9px;
              box-shadow: 0 16px 50px #0008;
              font: 14px/1.45 Inter, "Segoe UI", sans-serif;
            }
            .title { grid-column: 1 / -1; display: grid; place-items: center; background: #151f2e; color: #bccbdb; }
            aside { display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: #171e29; }
            .active, .settings { padding: 16px; }
            .active { background: #24364b; }
            .settings { margin-top: auto; border-top: 1px solid #354052; }
            .parsers { padding: 12px; overflow: hidden; }
            .row, header, .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
            .row { height: 29px; padding: 0 3px; }
            .row:first-child { height: 35px; }
            .search { height: 28px; margin: 12px 0 10px; border: 1px solid #42516a; border-radius: 4px; background: #101720; }
            .bar, .toggle, .button, .check { display: block; background: #293b51; border-radius: 4px; }
            .bar { width: 58%; height: 9px; }
            .toggle { width: 36px; height: 16px; border-radius: 9px; }
            main { display: flex; flex-direction: column; min-width: 0; }
            header, footer { background: #1b2330; padding: 14px 20px; }
            header { min-height: 34px; border-bottom: 1px solid #354052; font-size: 21px; font-weight: 650; }
            section { flex: 1; padding: 16px 20px; }
            .button { width: 66px; height: 30px; }
            header .button { width: 145px; }
            footer .button { width: 140px; background: #334d64; }
            .option { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
            .check { width: 13px; height: 13px; }
            footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid #354052; color: #bccbdb; }
          </style>
          <div class="window">
            <div class="title" aria-hidden="true">Steam ROM Manager</div>
            <aside aria-hidden="true">
              <div class="active">Add Games</div>
              <div class="parsers">
                <div class="row">Toggle Parse<i class="toggle"></i></div>
                <div class="search"></div>
                <div class="row"><i class="bar"></i></div>
                ${'<div class="row"><i class="bar"></i><i class="toggle"></i></div>'.repeat(9)}
              </div>
              <div class="settings">⚙ Settings</div>
            </aside>
            <main>
              <header aria-hidden="true">Importar juegos a Steam<i class="button"></i></header>
              <section aria-hidden="true">
                <div class="toolbar"><strong>Juegos</strong><i class="button"></i></div>
                <div class="option"><i class="check"></i><i class="bar"></i></div>
              </section>
              <footer><span role="status">Cargando importador…</span><i class="button" aria-hidden="true"></i></footer>
            </main>
          </div>`;
        doc.body.append(message);

        Millennium.callServerMethod(plugin, 'ImporterWindowState', {}).then(reply => {
            const raw = decode(reply);
            const bounds = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const view = doc.defaultView;
            if (!view || !bounds || !message.isConnected) return;
            const frame = shadow.querySelector('.window');
            if (bounds.isMaximized || bounds.isFullScreen) {
                frame.style.setProperty('--width', '100vw');
                frame.style.setProperty('--height', '100vh');
                return;
            }
            const width = Math.max(800, bounds.width);
            const height = Math.max(600, bounds.height);
            if (!Number.isFinite(width) || !Number.isFinite(height)) return;
            frame.style.setProperty('--width', width + 'px');
            frame.style.setProperty('--height', height + 'px');
            const x = bounds.x - view.screenX;
            const y = bounds.y - view.screenY;
            if (x >= 0 && y >= 0 && x + width <= view.innerWidth && y + height <= view.innerHeight) {
                Object.assign(frame.style, {position:'absolute', left:x + 'px', top:y + 'px'});
            }
        }).catch(() => {});
        return message;
    }

    async function intercept(event) {
        const label = event.target?.textContent?.trim().replace(/…$/, '...');
        if (!labels.has(label)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (launching) return;

        launching = true;
        const owner = event.target.ownerDocument.defaultView;
        const popups = typeof g_PopupManager === 'undefined' ? window.g_PopupManager : g_PopupManager;
        const desktop = popups?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup;
        const doc = desktop?.document?.body ? desktop.document : document;
        const message = showLoading(doc);
        let timer;
        let expired = false;
        try {
            owner?.dispatchEvent(new owner.KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', bubbles: true,
            }));
            await Promise.race([
                (async () => {
                    const result = decode(await Millennium.callServerMethod(plugin, 'OpenRomManager', {}));
                    if (result !== 'started') throw new Error(String(result));
                    while (!expired) {
                        const status = decode(await Millennium.callServerMethod(plugin, 'ImporterLaunchStatus', {}));
                        if (status === 'ready') return;
                        if (status !== 'pending') throw new Error(String(status));
                        await new Promise(resolve => setTimeout(resolve, 400));
                    }
                })(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        expired = true;
                        reject(new Error('El importador tardó demasiado en abrir.'));
                    }, 31000);
                }),
            ]);
        } catch (error) {
            message.remove();
            (doc.defaultView ?? window).alert('No se pudo abrir el importador. ' + error.message);
        } finally {
            clearTimeout(timer);
            message.remove();
            launching = false;
        }
    }

    function attach(doc) {
        if (!doc || documents.has(doc)) return;
        documents.add(doc);
        doc.addEventListener('click', intercept, true);
    }

    attach(document);
    Millennium.AddWindowCreateHook?.((popup) => attach(popup?.m_popup?.document));
    (window.PLUGIN_LIST ??= {})[plugin] = {
        __millennium_internal_plugin_name_do_not_use_or_change__: plugin,
    };
})();
