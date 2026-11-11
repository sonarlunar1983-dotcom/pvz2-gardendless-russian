(() => {
    const incoming = __CONFIG_JSON__;
    const VERSION = 46;
    const uiTranslations = __UI_TRANSLATIONS_JSON__;
    const fontAssets = __FONT_ASSETS_JSON__;
    const objectiveTranslations = __OBJECTIVE_TRANSLATIONS_JSON__;
    const documentTranslations = __DOCUMENT_TRANSLATIONS_JSON__;
    const documentStates = new Map();
    let documentObserver = null;
    const normalizeDocument = text => String(text).replace(/\r\n?/g, '\n');
    function restoreDocument(frame, state) {
        if(frame.srcdoc===state.translated)frame.srcdoc=state.original;
        if(frame.title===state.title)frame.title=state.originalTitle;
        if(state.dialog.getAttribute('aria-label')===state.title){
            if(state.originalLabel===null)state.dialog.removeAttribute('aria-label');
            else state.dialog.setAttribute('aria-label',state.originalLabel);
        }
        if(state.close?.getAttribute('aria-label')==='Закрыть'){
            if(state.originalCloseLabel===null)state.close.removeAttribute('aria-label');
            else state.close.setAttribute('aria-label',state.originalCloseLabel);
        }
        documentStates.delete(frame);
    }
    function syncDocumentDialogs(russian) {
        if(typeof document==='undefined'||typeof document.querySelectorAll!=='function')return;
        for(const [frame,state] of documentStates){
            if(frame.isConnected===false){documentStates.delete(frame);continue;}
            if(!russian||frame.srcdoc!==state.translated)restoreDocument(frame,state);
        }
        if(!russian)return;
        for(const frame of document.querySelectorAll('dialog iframe[srcdoc]')){
            if(documentStates.has(frame))continue;
            const original=frame.srcdoc,normalized=normalizeDocument(original);
            const translation=documentTranslations.find(item=>item.sources.some(source=>normalized.endsWith(normalizeDocument(source))));
            if(!translation)continue;
            const source=translation.sources.find(source=>normalized.endsWith(normalizeDocument(source)));
            const dialog=frame.closest('dialog');if(!dialog)continue;
            const close=dialog.querySelector('button[aria-label]');
            const translated=normalized.slice(0,normalized.length-normalizeDocument(source).length)+translation.html;
            const state={original,translated,title:translation.title,originalTitle:frame.title,dialog,originalLabel:dialog.getAttribute('aria-label'),close,originalCloseLabel:close?.getAttribute('aria-label')??null};
            documentStates.set(frame,state);
            frame.title=translation.title;dialog.setAttribute('aria-label',translation.title);
            close?.setAttribute('aria-label','Закрыть');frame.srcdoc=translated;
        }
    }
    function observeDocumentDialogs() {
        if(documentObserver||typeof MutationObserver==='undefined'||typeof document==='undefined'||!document.body)return;
        documentObserver=new MutationObserver(()=>{if(!disposed)syncDocumentDialogs(config.enabled&&russianIsSelected());});
        documentObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['srcdoc']});
    }
    const objectiveRules = objectiveTranslations.templates.map(({en,ru}) => {
        const keys = [];
        const pattern = en.split(/(<[A-Z]+>)/g).map(part => {
            if (/^<(?:S|ZS|TS)>$/.test(part)) return 's?';
            if (/^<[A-Z]+>$/.test(part)) {
                keys.push(part);
                return part === '<WORLDNAME>' ? '([^\\n]+?)' : '(\\d+(?:[.,]\\d+)?)';
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('');
        return {pattern:new RegExp('^'+pattern+'$'),keys,ru};
    });
    const previous = window.__pvzRuFontFix;
    if (previous?.version === VERSION && typeof previous.applyConfig === "function") {
        return previous.applyConfig(incoming);
    }
    try {
        if (typeof previous?.dispose === "function") previous.dispose();
        else previous?.restoreAll?.();
    } catch (_) {}

    const CYR = /[А-Яа-яЁё]/;
    const states = new WeakMap();
    const originalSegmentSpacing = new WeakMap();
    const translatedText = new WeakMap();
    const headingLayouts = new WeakMap();
    const hookedPrototypes = new WeakSet();
    const descriptorHooks = [];
    const activeWrites = new WeakSet();
    let richWriteDepth = 0;
    let disposed = false;
    let config = incoming;
    let timer = null;
    let stats = {scanned: 0, matched: 0, changed: 0, richText: 0, error: "", href: location.href};
    const sceneHandlers = [];
    let measureContext;
    function ancestorComponent(target, name) {
        const type = cc.js?.getClassByName?.(name);
        if (!type) return null;
        for(let node=target.node;node;node=node.parent){const component=node.getComponent?.(type);if(component)return component;}
        return null;
    }
    function pauseButtonRole(target) {
        const screen=ancestorComponent(target,'PauseScreen');
        return ['ExitToMap','Restart','Resume'].find(key=>screen?.tooltips?.[key]===target) || null;
    }
    function pauseAudioRole(target) {
        const screen=ancestorComponent(target,'PauseScreen');
        return ['Music','SoundFX'].find(key=>screen?.tooltips?.[key]===target) || null;
    }
    function isAlmanacFamilyValue(target) {
        const element = ancestorComponent(target,'AlmanacElementForPlant');
        return element?.valueLabel === target && /^(?:СЕМЕЙСТВО|FAMILY|家族)$/i.test(String(element.nameLabel?.string || '').trim());
    }
    function isMedalFamily(target) {
        return ancestorComponent(target,'PlantMedalDisplayer')?.FamilyNameLabel===target;
    }
    function isAlmanacMintName(target,text=String(target.string||'')) {
        return ancestorComponent(target,'AlmanacPlantPage')?.plantNameLabel===target && /мята$/i.test(text.trim());
    }
    const medalFamilyNames=['Укрепляющей мяты','Скрывающей мяты','Успокоительной мяты','Перечной мяты','Зимней мяты','Копейной мяты','Орудийной мяты','Болезнетворной мяты','Электромяты','Сдерживающей мяты','Чарующей мяты','Просветляющей мяты','Усиливающей мяты','Бомбардирующей мяты'];
    function uniformMedalFontSize(target,desired) {
        const bounds=cc.UITransform && target.node?.getComponent(cc.UITransform);
        const width=Number(bounds?.contentSize?.width || bounds?.width);
        if(!(width>0))return desired.fontSize;
        if(!measureContext && typeof document!=='undefined')measureContext=document.createElement('canvas').getContext('2d');
        const spacing=Number(desired.spacingX||0);
        for(let size=desired.fontSize;size>=1;size--){
            if(measureContext)measureContext.font=(desired.isBold?'bold ':'')+size+'px '+desired.fontFamily;
            const widest=Math.max(...medalFamilyNames.map(name=>(measureContext?measureContext.measureText(name).width:name.length*size*.75)+(name.length-1)*spacing));
            if(widest<=width*.94)return size;
        }
        return 1;
    }
    function isPinataPlay(target) {
        return ancestorComponent(target,'LevelOfTheDayDisplayer')?.play===target;
    }
    function fitPinataTitle(target,desired) {
        const bounds=cc.UITransform && target.node?.getComponent(cc.UITransform);
        const width=Number(bounds?.contentSize?.width || bounds?.width);
        if(!(width>0))return desired.fontSize;
        if(!measureContext && typeof document!=='undefined')measureContext=document.createElement('canvas').getContext('2d');
        const text=String(target.string||''),count=[...text].length;
        const padding=target.enableOutline?2*Number(target.outlineWidth||0):0;
        for(let size=desired.fontSize;size>=1;size--){
            if(measureContext)measureContext.font=(desired.isBold?'bold ':'')+(target.isItalic?'italic ':'')+size+'px '+desired.fontFamily;
            const measured=measureContext?.measureText(text);
            const ink=measured?Math.max(measured.width,Number(measured.actualBoundingBoxLeft||0)+Number(measured.actualBoundingBoxRight||0)):count*size;
            if(ink+Math.max(0,count-1)*Math.max(0,desired.spacingX)+padding<=width*.94)return size;
        }
        return 1;
    }
    function isPinataCooldown(target,text=String(target.string||'')) {
        return ancestorComponent(target,'LevelOfTheDayDisplayer')?.description===target && /^до следующего:\s*/i.test(text);
    }
    function isObjectiveContinue(target) {
        return ancestorComponent(target,'LevelObjectiveScreen')?.toolTips?.Continue===target;
    }
    function isSquareTipCaption(target) {
        return ancestorComponent(target,'SettingWindow')?.tooltips?.SquareTipMode===target;
    }
    function isLetsRock(target) {
        if(!/^Зажж[её]м!$/i.test(String(target.string||'').trim()))return false;
        return sceneOwner(target,'levelController',owner=>[owner.buttonToolTips?.LetsRock,owner.buttonToolTips?.PresetLetsRock].includes(target));
    }
    function sceneOwner(target,name,predicate) {
        const ancestor=ancestorComponent(target,name);
        if(ancestor && predicate(ancestor))return true;
        const type=cc.js?.getClassByName?.(name);
        return !!type && !!cc.director.getScene()?.getComponentsInChildren(type)?.some(predicate);
    }
    function isMainPlay(target) {
        return /^Играть$/i.test(String(target.string||'').trim()) && sceneOwner(target,'mainScene',owner=>owner.tooltips?.Play===target);
    }
    function isBoostCounter(target) {
        return /^ОСТАЛОСЬ УСИЛЕНИЙ:\s*\d+$/i.test(String(target.string||'').trim());
    }
    function localizeContextCaption(target,text) {
        if(isPinataCooldown(target,text))return text.replace(/^(до следующего:)\s*/i,'$1\n');
        if(ancestorComponent(target,'StoreCommodity')?.discountLabel===target && /^СКИДКА\s+\d+(?:[.,]\d+)?\s*%?$/i.test(text.trim()))return text.trim().replace(/\s*%?$/,'%');
        if(ancestorComponent(target,'StoreCommodity')?.leftTimeLabel===target && /^(?:ОСТАЛОСЬ|Осталось)\s+(?:\d+\s*[дчмс]\.\s*)+!?$/.test(text)){
            const result=text.replace(/\s+\d+\s*с\./g,'').trim();
            return /[1-9]\d*\s*[дчм]\./.test(result)?result:text.split(/\s/)[0]+' < 1 м.';
        }
        if(/^(?:ВЫЙТИ ИЗ УРОВНЯ|EXIT LEVEL)$/i.test(text.trim()) && sceneOwner(target,'UIInGame',owner=>owner.toolTips?.EXIT_TO_MAP===target))return text===text.toUpperCase()?'ВЫЙТИ':'Выйти';
        if(isAlmanacMintName(target,text))return text.replace(/\s*\n\s*/g,' ');
        if(isSquareTipCaption(target) && /^Отметки клеток\s+для растений$/i.test(text))return text.replace(/клеток\s+/i,'клеток\n');
        if(isMedalFamily(target)||isAlmanacFamilyValue(target))return text.replace(/\s*\n\s*/g,' ');
        const audio=pauseAudioRole(target);
        if(audio==='SoundFX' && /^(?:ЗВУКОВЫЕ ЭФФЕКТЫ|SOUND FX|SOUND EFFECTS)$/i.test(text.trim()))return 'Звук. эффекты';
        if(audio==='Music' && /^MUSIC$/i.test(text.trim()))return 'Музыка';
        const element=ancestorComponent(target,'AlmanacElementForPlant');
        if(element?.nameLabel===target && /^(?:СТОИМОСТЬ В СОЛНЦЕ|SUN COST)$/i.test(text.trim())) {
            return text===text.toUpperCase()?'СТОИМОСТЬ В СОЛНЦАХ':'Стоимость в солнцах';
        }
        const garden=ancestorComponent(target,'zenGardenScene');
        if(garden?.shovelWindowConfirmLabel===target && /^(?:ПОДТВЕРДИТЬ|CONFIRM)$/i.test(text.trim())) {
            return text===text.toUpperCase()?'ДА':'Да';
        }
        return null;
    }
    function localizeObjective(target,text) {
        if (!ancestorComponent(target,'PauseScreen') && !ancestorComponent(target,'LevelObjectiveScreen')) return null;
        for(const rule of objectiveRules){
            const match=text.match(rule.pattern);if(!match)continue;
            let result=rule.ru;
            rule.keys.forEach((key,index)=>{let value=match[index+1];if(key==='<WORLDNAME>')value=objectiveTranslations.worlds[value] || value;result=result.split(key).join(value);});
            return result;
        }
        return null;
    }
    function restoreBoostShift(target,state) {
        if(!state.shift)return false;
        const position=target.node?.position;
        if(position)target.node.setPosition(position.x===state.shift.lastX?state.shift.baseX:position.x,position.y===state.shift.lastY?state.shift.baseY:position.y,position.z);
        state.shift=null;return true;
    }
    function shiftBoostCounter(target,state,russian) {
        const pinata=russian && isPinataCountdown(target);
        const cooldown=russian && isPinataCooldown(target);
        const letsRock=russian && isLetsRock(target);
        const lower=russian && (isMainPlay(target) || isAlmanacFamilyValue(target) || isPinataPlay(target));
        const award = russian ? ancestorComponent(target, 'awardScene') : null;
        const newPlantContinue = award?.continueLabel === target
            && /^(?:\u0412\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u0438 \u043d\u043e\u0432\u043e\u0435 \u0440\u0430\u0441\u0442\u0435\u043d\u0438\u0435|You got a new plant)!?$/i.test(String(award.titleLabel?.string || '').trim());
        const boost=russian && isBoostCounter(target);
        const deckDescription=russian && ancestorComponent(target,'CardDeckDisplayer')?.description_label===target;
        const shovelBoost=russian && ancestorComponent(target,'zenGardenScene')?.shovelWindowDescriptionLabel===target && /но получите за него УСИЛЕНИЕ!/i.test(String(target.string||''));
        if(!pinata && !cooldown && !boost && !lower && !shovelBoost && !deckDescription && !newPlantContinue && !letsRock)return restoreBoostShift(target,state);
        const position=target.node?.position;if(!position||typeof target.node.setPosition!=='function')return false;
        if(!measureContext && typeof document!=='undefined')measureContext=document.createElement('canvas').getContext('2d');
        const positionFontSize=pinata?Math.max(1,Math.round(state.base.fontSize*Number(config.fontScale||1))):target.fontSize;
        let step=positionFontSize*.33;
        if(measureContext){measureContext.font=positionFontSize+'px '+target.fontFamily;step=measureContext.measureText(' ').width;}
        if(!state.shift)state.shift={baseX:position.x,baseY:position.y,lastX:position.x,lastY:position.y};
        else {
            if(position.x!==state.shift.lastX)state.shift.baseX=position.x;
            if(position.y!==state.shift.lastY)state.shift.baseY=position.y;
        }
        // Keep timer position stable while its font size changes between releases.
        const positionStep=step;
        const lowerSteps=russian && isMainPlay(target) ? 1 : .5;
        const x=state.shift.baseX-positionStep*(pinata?4:boost?10:deckDescription?-5:0),y=state.shift.baseY+(pinata?positionStep*10:cooldown?step*.75:shovelBoost?step*2:deckDescription?-step*1.5:newPlantContinue?-target.fontSize/2:letsRock?-target.fontSize*1.3:lower?-step*lowerSteps:0);
        if(position.x===x&&position.y===y)return false;
        target.node.setPosition(x,y,position.z);state.shift.lastX=x;state.shift.lastY=y;return true;
    }
    function restoreTimerOutline(target,state) {
        if(!state.timerOutline)return;
        Object.assign(target,state.timerOutline);state.timerOutline=null;
    }
    function thickenTimer(target,state,enabled) {
        if(!enabled){restoreTimerOutline(target,state);return;}
        if(!('enableOutline' in target))return;
        if(!state.timerOutline)state.timerOutline={enableOutline:target.enableOutline,outlineColor:target.outlineColor,outlineWidth:target.outlineWidth};
        target.outlineColor=target.color;target.outlineWidth=Math.max(.5,target.fontSize*.035);target.enableOutline=true;
    }
    const fontRegistry = window.__pvzRuFontAssets05 || (window.__pvzRuFontAssets05 = {ready:new Set(), promise:null, error:""});
    function loadFonts() {
        if (!fontAssets.length) return Promise.resolve();
        if (fontRegistry.promise) return fontRegistry.promise;
        fontRegistry.promise = Promise.all(fontAssets.map(async asset => {
            const face = new FontFace(asset.family, asset.source);
            await face.load();
            document.fonts.add(face);
            fontRegistry.ready.add(asset.family);
        })).then(() => { if (!disposed) scan(); }).catch(error => {
            fontRegistry.error = "Не удалось загрузить встроенные шрифты: " + String(error?.message || error);
        });
        return fontRegistry.promise;
    }
    function fontFamilyFor(state) {
        const selected = String(config.fontFamily || "Segoe UI");
        let label = selected;
        if (selected === "Garden Auto RU") {
            const identity = [state.base.fontName, state.base.fontUuid, state.base.fontFamily].join(" ").toLowerCase();
            label = /houseofterror|d9ae0370/.test(identity) ? "Garden Fright RU"
                : /pico12|ipix|22c9fd5a/.test(identity) ? "Garden Soft RU" : "Garden Note RU";
        }
        const asset = fontAssets.find(asset => asset.label === label);
        if (!asset) return selected;
        return fontRegistry.ready.has(asset.family) ? asset.family + ', "Segoe UI", sans-serif' : "Segoe UI";
    }

    function russianIsSelected() {
        try {
            const language = cc.js?.getClassByName?.("MultiLanguage");
            return language?.getString?.({en:"__probe_en",zh:"__probe_zh",ru:"__probe_ru"}, false) === "__probe_ru";
        } catch (_) { return false; }
    }

    function localizeUiValue(target, value, russian) {
        if (typeof value !== "string") return value;
        let previous = translatedText.get(target);
        if (previous && value !== previous.translated) {
            translatedText.delete(target); previous = null;
        }
        if (!config.enabled || !russian) {
            if (!previous) return value;
            translatedText.delete(target); return previous.original;
        }
        if (previous) return value;
        // Never translate player names or editable input as UI captions.
        for (let node = target.node; node; node = node.parent) {
            if (/player|editbox|input|chat/i.test(String(node.name || ""))) return value;
        }
        const original = value;
        let translated = Object.prototype.hasOwnProperty.call(uiTranslations, original) ? uiTranslations[original] : localizeTimer(original);
        const pauseRole=pauseButtonRole(target);
        if(pauseRole==='ExitToMap' && /^(?:EXIT LEVEL|ВЫЙТИ ИЗ УРОВНЯ|ВЫЙТИ)$/i.test(original.trim()))translated=original===original.toUpperCase()?'ВЫЙТИ':'Выйти';
        if(pauseRole==='Restart' && original==='RESTART')translated='ЗАНОВО';
        if(pauseRole==='Resume' && original==='RESUME')translated='ПРОДОЛЖИТЬ';
        const contextCaption=localizeContextCaption(target,typeof translated==='string'?translated:original);
        if(contextCaption!==null)translated=contextCaption;
        if(typeof translated!=='string')translated=localizeObjective(target,original);
        if (typeof translated !== "string") translated = localizeMedalDescription(original);
        if (typeof translated !== "string") {
            const reward = original.match(/^You've earned (\d+) today!$/);
            if (reward) translated = "Сегодня вы заработали " + reward[1] + "!";
        }
        if ((typeof translated === "string" ? translated : original) === "Сегодня вы упустили самоцветы!") {
            translated = "Сегодня вы упустили\nсамоцветы!";
        }
        if (typeof translated !== "string" || original === translated) return value;
        translatedText.set(target, {original, translated}); return translated;
    }

    function translateUi(target, russian) {
        const before = target.string;
        const after = localizeUiValue(target, before, russian);
        if (before === after) return false;
        target.string = after; return true;
    }

    function localizeMedalDescription(text) {
        const match = text.match(/^(Откройте медаль каждого растения,\s*использовав )(\d+) усилени(?:й|я|е)\.$/);
        if (!match) return null;
        const count = Number(match[2]), last = count % 10, teen = count % 100;
        const word = teen >= 11 && teen <= 14 ? "усилений" : last === 1 ? "усиление" : last >= 2 && last <= 4 ? "усиления" : "усилений";
        return match[1] + match[2] + " " + word + ".";
    }

    function isMedalDescription(text) {
        return /^Откройте медаль каждого растения,\s*использовав (?:\d+|<TARGETBOOSTCOUNT>) усилени(?:й|я|е)\.$/.test(text);
    }

    function inRichLayout(action) {
        richWriteDepth++;
        try { return action(); } finally { richWriteDepth--; }
    }

    function isRichSegment(label) {
        if (richWriteDepth > 0 || /^RICHTEXT(?:_|$)/.test(String(label.node?.name || ""))) return true;
        if (typeof cc === "undefined" || !cc.RichText) return false;
        for (let node = label.node?.parent; node; node = node.parent) {
            if (node.getComponent?.(cc.RichText)) return true;
        }
        return false;
    }

    function installStringHook(type, rich) {
        const prototype = type?.prototype;
        if (!prototype || hookedPrototypes.has(prototype)) return;
        const own = Object.getOwnPropertyDescriptor(prototype, "string");
        let owner = prototype, descriptor = own;
        while (!descriptor && (owner = Object.getPrototypeOf(owner))) descriptor = Object.getOwnPropertyDescriptor(owner, "string");
        if (typeof descriptor?.get !== "function" || typeof descriptor?.set !== "function" || own?.configurable === false) {
            throw new Error("Cocos string accessor cannot be hooked: " + (rich ? "RichText" : "Label"));
        }
        const setter = function(value) {
            if (disposed || activeWrites.has(this) || !this.node || this.isValid === false || (!rich && isRichSegment(this))) {
                return descriptor.set.call(this, value);
            }
            activeWrites.add(this);
            try {
                const russian = russianIsSelected();
                let rendered = value;
                try { rendered = localizeUiValue(this, value, russian); }
                catch (error) { stats.error = String(error?.message || error); }
                const apply = () => {
                    // The native setter only ever receives the localized value,
                    // so a frame cannot display the English intermediate text.
                    const result = descriptor.set.call(this, rendered);
                    try {
                        if (!rich) fitUpdatesHeading(this, russian);
                        fix(this, rich, russian);
                    } catch (error) { stats.error = String(error?.message || error); }
                    return result;
                };
                return rich ? inRichLayout(apply) : apply();
            } finally { activeWrites.delete(this); }
        };
        Object.defineProperty(prototype, "string", {...descriptor, configurable:true, set:setter});
        hookedPrototypes.add(prototype); descriptorHooks.push({prototype, own, setter});
    }

    function ensureStringHooks() {
        if (typeof cc === "undefined") return;
        installStringHook(cc.Label, false); installStringHook(cc.RichText, true);
    }

    function removeStringHooks() {
        for (const hook of descriptorHooks.reverse()) {
            if (Object.getOwnPropertyDescriptor(hook.prototype, "string")?.set !== hook.setter) continue;
            if (hook.own) Object.defineProperty(hook.prototype, "string", hook.own);
            else delete hook.prototype.string;
        }
        descriptorHooks.length = 0;
    }

    function localizeTimer(text) {
        const units = {d:"д.", h:"ч.", m:"м.", min:"м.", s:"с."};
        const time = "(?:\\d+\\s*(?:min|d|h|m|s)\\s*)+";
        let body = text, prefix = "", suffix = "";
        const knownPrefix = /^(ОСТАЛОСЬ|Осталось|Истекает через|бесплатно через|до следующего:|Expire in|free in)\s+([\s\S]+)$/;
        const prefixed = text.match(knownPrefix);
        if (prefixed) {
            prefix = ({"Expire in":"Истекает через", "free in":"бесплатно через"})[prefixed[1]] || prefixed[1];
            prefix += " "; body = prefixed[2];
        } else {
            const left = text.match(new RegExp("^\\s*(" + time + ")\\s*LEFT!?$"));
            if (left) { prefix = "Осталось "; body = left[1]; }
            else {
                const until = text.match(new RegExp("^\\s*(" + time + ")\\s*until next$"));
                if (until) { prefix = "до следующего: "; body = until[1]; }
            }
        }
        if (body.endsWith("!")) { suffix = "!"; body = body.slice(0, -1); }
        if (!new RegExp("^\\s*" + time + "$" ).test(body)) return null;
        const result = body.trim().replace(/(\d+)\s*(min|d|h|m|s)\b/g, (_, count, unit) => count + " " + units[unit]);
        return prefix + result + suffix;
    }

    function fitUpdatesHeading(label, russian) {
        const shrink = cc.Label?.Overflow?.SHRINK;
        const text = String(label.string || "").trim();
        const updates = text.toUpperCase() === "ОБНОВЛЕНИЯ";
        const settings = ancestorComponent(label,'SettingWindow')?.tooltips?.Title===label;
        const pinataTitle = ancestorComponent(label,'LevelOfTheDayDisplayer')?.title===label;
        const arcadeVerdict = /^(?:Не на месте|Частично верно|Вс[её] неверно|Верно)$/.test(text);
        const medal = isMedalDescription(text);
        const arcade = text === "Дополнительные мини-игры!" || text.startsWith("Пробуйте разные варианты,\nследуйте подсказкам");
        const missedGems = text === "Сегодня вы упустили\nсамоцветы!";
        const family = isAlmanacFamilyValue(label);
        const mintName = isAlmanacMintName(label);
        const medalFamily = isMedalFamily(label);
        const wrap = medal || arcade || missedGems || isSquareTipCaption(label) || isPinataCooldown(label);
        const shouldFit = config.enabled && russian && (updates || settings || pinataTitle || arcadeVerdict || medalFamily || family || mintName || wrap) && shrink !== undefined;
        const saved = headingLayouts.get(label);
        if (!shouldFit) {
            if (!saved) return false;
            label.enableWrapText = saved.enableWrapText; label.overflow = saved.overflow;
            headingLayouts.delete(label); label.updateRenderData?.(true); return true;
        }
        if (!saved) headingLayouts.set(label, {enableWrapText:label.enableWrapText, overflow:label.overflow});
        // Medal pages share one measured font size; per-string SHRINK would undo uniformity.
        const overflow=medalFamily?(cc.Label?.Overflow?.CLAMP ?? cc.Label?.Overflow?.NONE ?? 0):shrink;
        const changed = label.enableWrapText !== wrap || label.overflow !== overflow;
        label.enableWrapText = wrap; label.overflow = overflow;
        if (changed) label.updateRenderData?.(true);
        return changed;
    }

    function components(type) {
        if (typeof cc === "undefined" || !type || !cc.director) return [];
        return cc.director.getScene()?.getComponentsInChildren(type) || [];
    }

    function remember(target, rich) {
        let state = states.get(target);
        if (!state) {
            state = {
                base: {
                    fontSize: target.fontSize,
                    lineHeight: target.lineHeight,
                    useSystemFont: target.useSystemFont,
                    fontFamily: target.fontFamily,
                    isBold: target.isBold,
                    font: target.font,
                    fontName: target.font?.name || target.font?._name || "",
                    fontUuid: target.font?._uuid || "",
                    spacingX: target.spacingX
                },
                rich, last: null, hook: null, originalApply: null,
                segmentSpacing: new Map()
            };
            states.set(target, state);
        } else if (state.last) {
            for (const key of ["fontSize", "lineHeight"]) {
                if (typeof target[key] === "number" && target[key] !== state.last[key]) state.base[key] = target[key];
            }
        }
        return state;
    }

    function reflow(rich) {
        // Cocos 3.x stores positions of separate colour/formatting segments.
        // The layout must measure the same font and spacing as the renderer.
        rich._layoutDirty = true;
        if (typeof rich._updateRichText === "function") rich._updateRichText();
    }

    function installSpacingHook(target, state) {
        if (state.hook || typeof target._applyTextAttribute !== "function") return false;
        state.originalApply = target._applyTextAttribute;
        state.hook = function(segment, ...args) {
            const result = state.originalApply.call(this, segment, ...args);
            const label = segment?.node?.getComponent(cc.Label);
            if (label) {
                if (!originalSegmentSpacing.has(label)) originalSegmentSpacing.set(label, label.spacingX);
                if (!state.segmentSpacing.has(label)) state.segmentSpacing.set(label, originalSegmentSpacing.get(label));
                const spacing = Number(config.spacingX || 0);
                if (label.spacingX !== spacing) {
                    label.spacingX = spacing;
                    label.updateRenderData?.(true);
                }
            }
            return result;
        };
        target._applyTextAttribute = state.hook;
        return true;
    }

    function restore(target) {
        const state = states.get(target);
        if (!state) return false;
        restoreBoostShift(target,state);
        restoreTimerOutline(target,state);
        if (state.rich) {
            if (target._applyTextAttribute === state.hook) target._applyTextAttribute = state.originalApply;
            for (const [label, spacing] of state.segmentSpacing) {
                // Cocos pools labels. An old segment may already belong to
                // a different RichText, so do not alter that owner's layout.
                if (label.isValid !== false && (!label.node?.parent || label.node.parent === target.node)) {
                    label.spacingX = spacing; label.updateRenderData?.(true);
                }
            }
        }
        if (state.base.font !== undefined) target.font = state.base.font;
        if (!state.rich && typeof state.base.isBold === "boolean") target.isBold = state.base.isBold;
        for (const key of ["fontSize", "lineHeight", "useSystemFont", "fontFamily"]) target[key] = state.base[key];
        if (!state.rich) target.spacingX = state.base.spacingX;
        states.delete(target);
        if (state.rich) reflow(target);
        return true;
    }

    function matches(target) {
        return !config.onlyCyrillic || CYR.test(String(target.string || ""));
    }

    function fix(target, rich, russian) {
        return rich ? inRichLayout(() => fixAppearance(target, true, russian)) : fixAppearance(target, false, russian);
    }

    function isPinataCountdown(label) {
        const type = cc.js?.getClassByName?.("LevelOfTheDayDisplayer");
        if (!type) return false;
        for (let node = label.node; node; node = node.parent) {
            const displayer = node.getComponent?.(type);
            if (displayer?.today_left_time === label) return true;
        }
        return false;
    }

    function fixAppearance(target, rich, russian) {
        if (!config.enabled || !matches(target)) {
            let changed = restore(target);
            // Also undo spacing inherited from a pooled Cyrillic segment in
            // an English-only RichText that has never been patched itself.
            if (rich) {
                for (const segment of target._segments || []) {
                    const label = segment.node?.getComponent(cc.Label);
                    if (label && originalSegmentSpacing.has(label) && label.spacingX !== originalSegmentSpacing.get(label)) {
                        label.spacingX = originalSegmentSpacing.get(label);
                        label.updateRenderData?.(true); changed = true;
                    }
                }
                if (changed) reflow(target);
            }
            return changed;
        }
        const state = remember(target, rich);
        const text = String(target.string || "");
        const localScale = russian && (/^Истекает через\s+\d/.test(text) || isMedalDescription(text)) ? 0.8 : 1;
        const titleScale = !russian ? 1 : ancestorComponent(target,'SettingWindow')?.tooltips?.PocketUI===target ? .8 : isSquareTipCaption(target) ? .7 : isAlmanacFamilyValue(target) ? 0.81*0.85 : isMedalFamily(target) ? 0.8 : isObjectiveContinue(target) ? 0.85*.95 : isPinataCountdown(target) ? .95 : pauseButtonRole(target) ? 0.81 : (text.trim() === "Шифр растений" || pauseAudioRole(target)) ? 0.9 : 1;
        const desired = {
            useSystemFont: true,
            fontFamily: fontFamilyFor(state),
            fontSize: Math.max(1, Math.round(Number(state.base.fontSize || 1) * Number(config.fontScale || 1) * localScale * titleScale)),
            lineHeight: state.base.lineHeight > 0
                ? Math.max(1, Math.round(state.base.lineHeight * Number(config.lineHeightScale || 1) * localScale))
                : target.lineHeight
        };
        if(russian && isAlmanacMintName(target))desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.95));
        if(russian && ancestorComponent(target,'PinataPrizeDisplayer')?.DescriptionLabel===target)desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.95));
        if(russian && ancestorComponent(target,'LevelOfTheDayDisplayer')?.description===target && !isPinataCooldown(target))desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.85));
        if(russian && ancestorComponent(target,'LevelOfTheDayDisplayer')?.title===target)desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*2/3*.85));
        if(russian && isPinataCooldown(target)){
            desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.65*1.25));
            desired.lineHeight=Math.max(1,Math.round(desired.fontSize*1.1));
        }
        if(russian && ancestorComponent(target,'StoreCommodity')?.leftTimeLabel===target)desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.7));
        if(russian && ancestorComponent(target,'StoreCommodity')?.discountLabel===target)desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.8));
        if(russian && ancestorComponent(target,'AlmanacUpgradeDisplay')?.titleLabel===target)desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.9*.85));
        const award=ancestorComponent(target,'awardScene');
        if(russian && award?.continueLabel===target && /Ключ от мира|World Key/i.test(String(award.titleLabel?.string||'')))desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*.85));
        if(russian){
            const settings=ancestorComponent(target,'SettingWindow');
            const settingsScale=settings?.tooltips?.SoundFX===target ? .85 : settings?.musicTitleLabel===target ? .8 : 1;
            if(settingsScale!==1)desired.fontSize=Math.max(1,Math.round(Number(state.base.fontSize||1)*Number(config.fontScale||1)*settingsScale));
        }
        if (!rich) {
            desired.spacingX = Number(config.spacingX || 0) + (russian && isBoostCounter(target) ? Math.max(2,desired.fontSize*.12) : 0);
            desired.isBold = Boolean(state.base.isBold || (russian && (isPinataCountdown(target) || isPinataCooldown(target))));
            if(russian && isMedalFamily(target))desired.fontSize=Math.max(1,Math.round(Math.round(uniformMedalFontSize(target,desired)*.75)*.8));
            if(russian && ancestorComponent(target,'LevelOfTheDayDisplayer')?.title===target)desired.fontSize=fitPinataTitle(target,desired);
        }
        let changed = rich ? installSpacingHook(target, state) : false;
        if (rich && state.last?.spacingX !== Number(config.spacingX || 0)) changed = true;
        for (const [key, value] of Object.entries(desired)) {
            if (target[key] !== value) { target[key] = value; changed = true; }
        }
        state.last = {...desired, spacingX: Number(config.spacingX || 0)};
        if(!rich){
            thickenTimer(target,state,russian && isPinataCountdown(target));
            if(shiftBoostCounter(target,state,russian))changed=true;
        }
        if (rich && changed) reflow(target);
        return changed;
    }

    function richTextOwner(label, richNodes) {
        for (let node = label.node; node; node = node.parent) if (richNodes.has(node)) return true;
        return false;
    }

    function scan() {
        if (disposed) return {...stats, disposed:true};
        let scanned = 0, matched = 0, changed = 0, richCount = 0, uiTranslated = 0;
        try {
            ensureStringHooks();
            const russian = russianIsSelected();
            observeDocumentDialogs();
            syncDocumentDialogs(config.enabled && russian);
            const richTexts = components(typeof cc !== "undefined" ? cc.RichText : null);
            const richNodes = new Set(richTexts.map(rich => rich.node));
            for (const rich of richTexts) {
                if (translateUi(rich, russian)) uiTranslated++;
                scanned++; richCount++;
                if (config.enabled && matches(rich)) matched++;
                if (fix(rich, true, russian)) changed++;
            }
            // RichText creates/recycles its labels during reflow. Obtain them
            // afterwards, and never independently resize its child labels.
            for (const label of components(typeof cc !== "undefined" ? cc.Label : null)) {
                if (richTextOwner(label, richNodes)) continue;
                if (translateUi(label, russian)) uiTranslated++;
                if (fitUpdatesHeading(label, russian)) changed++;
                scanned++;
                if (config.enabled && matches(label)) matched++;
                if (fix(label, false, russian)) changed++;
            }
            stats = {scanned, matched, changed, richText: richCount, uiTranslated, writeHooks:descriptorHooks.length, embeddedFonts:fontRegistry.ready.size, href: location.href, error: fontRegistry.error};
        } catch (e) {
            stats = {...stats, error: String(e?.message || e)};
        }
        return {...stats};
    }

    function restartTimer() {
        if (timer !== null) clearInterval(timer);
        timer = setInterval(scan, Math.max(50, Number(config.scanIntervalMs || 250)));
    }

    function restoreAll() {
        syncDocumentDialogs(false);
        for (const rich of components(typeof cc !== "undefined" ? cc.RichText : null)) { inRichLayout(() => { translateUi(rich, false); restore(rich); }); }
        for (const label of components(typeof cc !== "undefined" ? cc.Label : null)) { translateUi(label, false); fitUpdatesHeading(label, false); restore(label); }
    }

    window.__pvzRuFontFix = {
        version: VERSION,
        scan,
        applyConfig(next) { config = {...config, ...next}; restartTimer(); return scan(); },
        restoreAll,
        dispose() {
            disposed = true;
            documentObserver?.disconnect();documentObserver=null;
            if (timer !== null) clearInterval(timer);
            timer = null;
            if (typeof cc !== "undefined") {
                for (const handler of sceneHandlers) cc.director.off?.(cc.Director.EVENT_AFTER_SCENE_LAUNCH, handler);
            }
            removeStringHooks(); restoreAll();
        },
        getConfig: () => ({...config}),
        getStats: () => ({...stats})
    };
    try {
        const handler = () => { setTimeout(scan, 0); setTimeout(scan, 100); setTimeout(scan, 500); };
        cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, handler);
        sceneHandlers.push(handler);
    } catch (_) {}
    restartTimer();
    window.__pvzRuFontFix.ready = loadFonts();
    return scan();
})();
