const MILLENNIUM_IS_CLIENT_MODULE = true;

(() => {
    const plugin = 'rom-manager-launcher';
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
        message.setAttribute('role', 'status');
        const text = doc.createElement('span');
        text.textContent = 'Cargando Steam ROM Manager…';
        const covers = doc.createElement('span');
        covers.setAttribute('aria-hidden', 'true');
        Object.assign(covers.style, {display:'flex', gap:'3px', flex:'none'});
        for (const color of ['#567695', '#354d66', '#405e7b']) {
            const cover = doc.createElement('span');
            Object.assign(cover.style, {
                width:'10px', height:'15px', borderRadius:'2px', background:color,
                border:'1px solid #7595b340', boxSizing:'border-box',
            });
            covers.append(cover);
        }
        message.append(covers, text);
        Object.assign(message.style, {
            position:'fixed', left:'50%', top:'22px', transform:'translateX(-50%)',
            display:'flex', alignItems:'center', gap:'10px', maxWidth:'calc(100% - 32px)',
            zIndex:'2147483647', border:'1px solid #47617a', borderRadius:'9px',
            padding:'9px 13px', background:'#202c3b', color:'#e8edf6',
            boxShadow:'0 4px 18px #0007', font:'600 14px Inter, Segoe UI, sans-serif',
            pointerEvents:'none',
        });
        doc.body.append(message);
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
        const desktop = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup;
        const doc = desktop?.document?.body ? desktop.document : document;
        const message = showLoading(doc);
        let timer;
        try {
            owner?.dispatchEvent(new owner.KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', bubbles: true,
            }));
            await Promise.race([
                (async () => {
                    const result = decode(await Millennium.callServerMethod(plugin, 'OpenRomManager', {}));
                    if (result !== 'started') throw new Error(String(result));
                    for (let i = 0; i < 75; i++) {
                        const status = decode(await Millennium.callServerMethod(plugin, 'ImporterLaunchStatus', {}));
                        if (status === 'ready') return;
                        if (status !== 'pending') throw new Error(String(status));
                        await new Promise(resolve => setTimeout(resolve, 400));
                    }
                })(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('El importador tardó demasiado en abrir.')), 31000);
                }),
            ]);
        } catch (error) {
            (doc.defaultView ?? window).alert('No se pudo abrir Steam ROM Manager. ' + error.message);
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
