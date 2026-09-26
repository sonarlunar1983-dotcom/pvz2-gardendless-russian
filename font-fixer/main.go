//go:build windows

package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const (
	appTitle = "PvZ2 Gardendless — Font Fixer 1.0"

	IDC_GAME_PATH  = 1001
	IDC_FONT       = 1003
	IDC_SCALE      = 1004
	IDC_SPACING    = 1005
	IDC_LINE_SCALE = 1006
	IDC_ONLY_CYR   = 1008
	IDC_LAUNCH     = 1010
	IDC_APPLY      = 1011
	IDC_RESET      = 1013
	IDC_STATUS     = 1014

	WM_CREATE        = 0x0001
	WM_DESTROY       = 0x0002
	WM_COMMAND       = 0x0111
	WM_TIMER         = 0x0113
	WM_SETFONT       = 0x0030
	WM_GETTEXT       = 0x000D
	WM_GETTEXTLENGTH = 0x000E

	EM_SETSEL     = 0x00B1
	EM_REPLACESEL = 0x00C2

	BM_GETCHECK   = 0x00F0
	BM_SETCHECK   = 0x00F1
	BST_UNCHECKED = 0
	BST_CHECKED   = 1

	CB_ADDSTRING = 0x0143
	CB_SETCURSEL = 0x014E

	WS_OVERLAPPED  = 0x00000000
	WS_CAPTION     = 0x00C00000
	WS_SYSMENU     = 0x00080000
	WS_MINIMIZEBOX = 0x00020000
	WS_VISIBLE     = 0x10000000
	WS_CHILD       = 0x40000000
	WS_BORDER      = 0x00800000
	WS_TABSTOP     = 0x00010000
	WS_VSCROLL     = 0x00200000

	BS_PUSHBUTTON   = 0x00000000
	BS_AUTOCHECKBOX = 0x00000003

	ES_LEFT        = 0x0000
	ES_AUTOHSCROLL = 0x0080
	ES_MULTILINE   = 0x0004
	ES_AUTOVSCROLL = 0x0040
	ES_READONLY    = 0x0800

	CBS_DROPDOWN    = 0x0002
	CBS_AUTOHSCROLL = 0x0040

	SW_SHOW          = 5
	COLOR_BTNFACE    = 15
	DEFAULT_GUI_FONT = 17

	CW_USEDEFAULT = 0x80000000
)

type POINT struct{ X, Y int32 }
type MSG struct {
	Hwnd    syscall.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      POINT
}
type WNDCLASSEX struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     syscall.Handle
	HIcon         syscall.Handle
	HCursor       syscall.Handle
	HbrBackground syscall.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       syscall.Handle
}

type Config struct {
	GamePath        string  `json:"gamePath"`
	FontFamily      string  `json:"fontFamily"`
	FontScale       float64 `json:"fontScale"`
	SpacingX        int     `json:"spacingX"`
	LineHeightScale float64 `json:"lineHeightScale"`
	ScanIntervalMs  int     `json:"scanIntervalMs"`
	OnlyCyrillic    bool    `json:"onlyCyrillic"`
	Enabled         bool    `json:"enabled"`
}

func defaultConfig() Config {
	return Config{
		FontFamily:      "Segoe UI",
		FontScale:       0.90,
		SpacingX:        0,
		LineHeightScale: 0.95,
		ScanIntervalMs:  250,
		OnlyCyrillic:    true,
		Enabled:         true,
	}
}

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")

	procRegisterClassExW     = user32.NewProc("RegisterClassExW")
	procCreateWindowExW      = user32.NewProc("CreateWindowExW")
	procDefWindowProcW       = user32.NewProc("DefWindowProcW")
	procShowWindow           = user32.NewProc("ShowWindow")
	procUpdateWindow         = user32.NewProc("UpdateWindow")
	procGetMessageW          = user32.NewProc("GetMessageW")
	procTranslateMessage     = user32.NewProc("TranslateMessage")
	procDispatchMessageW     = user32.NewProc("DispatchMessageW")
	procPostQuitMessage      = user32.NewProc("PostQuitMessage")
	procSendMessageW         = user32.NewProc("SendMessageW")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
	procGetWindowTextW       = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW = user32.NewProc("GetWindowTextLengthW")
	procSetTimer             = user32.NewProc("SetTimer")
	procLoadCursorW          = user32.NewProc("LoadCursorW")

	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	procGetStockObject   = gdi32.NewProc("GetStockObject")

	hMain, hGamePath, hFont, hScale, hSpacing, hLineScale syscall.Handle
	hOnlyCyr, hStatus                                     syscall.Handle

	statusCh = make(chan string, 128)

	clientMu sync.Mutex
	client   *CDPClient
	launched atomic.Bool
)

func utf16Ptr(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func loword(v uintptr) uint16 { return uint16(v & 0xffff) }

func createControl(class, text string, style uint32, x, y, w, h int32, parent syscall.Handle, id int) syscall.Handle {
	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(utf16Ptr(class))),
		uintptr(unsafe.Pointer(utf16Ptr(text))),
		uintptr(style|WS_CHILD|WS_VISIBLE),
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		uintptr(parent), uintptr(id), 0, 0,
	)
	if hwnd == 0 {
		return 0
	}
	font, _, _ := procGetStockObject.Call(DEFAULT_GUI_FONT)
	procSendMessageW.Call(hwnd, WM_SETFONT, font, 1)
	return syscall.Handle(hwnd)
}

func getText(hwnd syscall.Handle) string {
	n, _, _ := procGetWindowTextLengthW.Call(uintptr(hwnd))
	buf := make([]uint16, n+1)
	procGetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), n+1)
	return syscall.UTF16ToString(buf)
}

func setText(hwnd syscall.Handle, s string) {
	procSetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(utf16Ptr(s))))
}

func isChecked(hwnd syscall.Handle) bool {
	r, _, _ := procSendMessageW.Call(uintptr(hwnd), BM_GETCHECK, 0, 0)
	return r == BST_CHECKED
}

func setChecked(hwnd syscall.Handle, v bool) {
	state := uintptr(BST_UNCHECKED)
	if v {
		state = BST_CHECKED
	}
	procSendMessageW.Call(uintptr(hwnd), BM_SETCHECK, state, 0)
}

func appendStatus(s string) {
	select {
	case statusCh <- time.Now().Format("15:04:05") + "  " + s:
	default:
	}
}

func drainStatus() {
	latest := ""
	for {
		select {
		case s := <-statusCh:
			latest = s
		default:
			if latest != "" {
				setText(hStatus, latest)
			}
			return
		}
	}
}

func configPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	dir = filepath.Join(dir, "PvZ2GardendlessFontFix")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "settings.json")
}

func loadConfig() Config {
	cfg := defaultConfig()
	data, err := os.ReadFile(configPath())
	if err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	return cfg
}

func saveConfig(cfg Config) error {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(configPath(), data, 0644)
}

func configFromUI() (Config, error) {
	cfg := Config{}
	cfg.GamePath = strings.TrimSpace(getText(hGamePath))
	cfg.FontFamily = strings.TrimSpace(getText(hFont))
	if cfg.FontFamily == "" {
		return cfg, errors.New("укажите семейство шрифта")
	}

	scale, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(getText(hScale)), ",", "."), 64)
	if err != nil || scale < 20 || scale > 200 {
		return cfg, errors.New("масштаб шрифта должен быть от 20 до 200%")
	}
	cfg.FontScale = scale / 100.0

	spacing, err := strconv.Atoi(strings.TrimSpace(getText(hSpacing)))
	if err != nil || spacing < -20 || spacing > 50 {
		return cfg, errors.New("spacingX должен быть от -20 до 50")
	}
	cfg.SpacingX = spacing

	lineScale, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(getText(hLineScale)), ",", "."), 64)
	if err != nil || lineScale < 20 || lineScale > 200 {
		return cfg, errors.New("масштаб высоты строки должен быть от 20 до 200%")
	}
	cfg.LineHeightScale = lineScale / 100.0

	cfg.ScanIntervalMs = 250
	cfg.OnlyCyrillic = isChecked(hOnlyCyr)
	cfg.Enabled = true
	return cfg, nil
}

func fillUI(cfg Config) {
	setText(hGamePath, cfg.GamePath)
	setText(hFont, cfg.FontFamily)
	setText(hScale, strconv.FormatFloat(cfg.FontScale*100, 'f', 0, 64))
	setText(hSpacing, strconv.Itoa(cfg.SpacingX))
	setText(hLineScale, strconv.FormatFloat(cfg.LineHeightScale*100, 'f', 0, 64))
	setChecked(hOnlyCyr, cfg.OnlyCyrillic)
}

func resetDefaults() {
	old := loadConfig()
	cfg := defaultConfig()
	cfg.GamePath = old.GamePath
	fillUI(cfg)
	_ = saveConfig(cfg)
	appendStatus("Настройки сброшены. Если игра подключена, применяю значения по умолчанию...")
	applyConfigAsync(cfg)
}

func buildInstallerJS(cfg Config) string {
	cfgJSON, _ := json.Marshal(cfg)
	return fmt.Sprintf(`(() => {
const incoming = %s;
const VERSION = 5;
if (window.__pvzRuFontFix && window.__pvzRuFontFix.version === VERSION && typeof window.__pvzRuFontFix.applyConfig === "function") {
    window.__pvzRuFontFix.applyConfig(incoming);
    return window.__pvzRuFontFix.getStats();
}
try {
    if (window.__pvzRuFontFix && typeof window.__pvzRuFontFix.restoreAll === "function") {
        window.__pvzRuFontFix.restoreAll();
    }
} catch (_) {}

const CYR = /[А-Яа-яЁё]/;
const KEY = "__pvzRuFontFixOriginal";
const LAST = "__pvzRuFontFixLast";
let config = incoming;
let timer = null;
let stats = { scanned: 0, matched: 0, changed: 0, href: location.href, error: "" };

function labels() {
    try {
        if (typeof cc === "undefined" || !cc.director || !cc.Label) return [];
        const scene = cc.director.getScene();
        if (!scene || typeof scene.getComponentsInChildren !== "function") return [];
        return scene.getComponentsInChildren(cc.Label) || [];
    } catch (e) {
        stats.error = String(e && e.message ? e.message : e);
        return [];
    }
}

function remember(label) {
    if (!label[KEY]) {
        label[KEY] = {
            fontSize: label.fontSize,
            lineHeight: label.lineHeight,
            useSystemFont: label.useSystemFont,
            fontFamily: label.fontFamily,
            spacingX: label.spacingX
        };
        return;
    }
    const last = label[LAST];
    if (last) {
        if (typeof label.fontSize === "number" && label.fontSize !== last.fontSize) {
            label[KEY].fontSize = label.fontSize;
        }
        if (typeof label.lineHeight === "number" && label.lineHeight !== last.lineHeight) {
            label[KEY].lineHeight = label.lineHeight;
        }
    }
}

function restore(label) {
    const base = label[KEY];
    if (!base) return;
    try {
        label.fontSize = base.fontSize;
        label.lineHeight = base.lineHeight;
        label.useSystemFont = base.useSystemFont;
        label.fontFamily = base.fontFamily;
        label.spacingX = base.spacingX;
        delete label[LAST];
    } catch (_) {}
}

function matches(label) {
    if (!config.onlyCyrillic) return true;
    return CYR.test(String(label.string || ""));
}

function fix(label) {
    if (!config.enabled || !matches(label)) {
        restore(label);
        return false;
    }
    try {
        remember(label);
        const base = label[KEY];
        const newFont = Math.max(1, Math.round(Number(base.fontSize || label.fontSize || 1) * Number(config.fontScale || 1)));
        const baseLine = Number(base.lineHeight || 0);
        const newLine = baseLine > 0 ? Math.max(1, Math.round(baseLine * Number(config.lineHeightScale || 1))) : label.lineHeight;
        const changed = label.useSystemFont !== true ||
            String(label.fontFamily || "") !== String(config.fontFamily || "Segoe UI") ||
            Number(label.spacingX || 0) !== Number(config.spacingX || 0) ||
            Number(label.fontSize || 0) !== newFont ||
            (baseLine > 0 && Number(label.lineHeight || 0) !== newLine);

        label.useSystemFont = true;
        label.fontFamily = String(config.fontFamily || "Segoe UI");
        label.spacingX = Number(config.spacingX || 0);
        label.fontSize = newFont;
        if (baseLine > 0) label.lineHeight = newLine;
        label[LAST] = { fontSize: label.fontSize, lineHeight: label.lineHeight };
        return changed;
    } catch (e) {
        stats.error = String(e && e.message ? e.message : e);
        return false;
    }
}

function scan() {
    const all = labels();
    let matched = 0;
    let changed = 0;
    for (const label of all) {
        if (config.enabled && matches(label)) matched++;
        if (fix(label)) changed++;
    }
    stats = {
        scanned: all.length,
        matched,
        changed,
        href: location.href,
        error: stats.error || ""
    };
    return Object.assign({}, stats);
}

function restartTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(scan, Math.max(50, Number(config.scanIntervalMs || 250)));
}

function applyConfig(next) {
    config = Object.assign({}, config, next || {});
    restartTimer();
    return scan();
}

window.__pvzRuFontFix = {
    version: VERSION,
    applyConfig,
    scan,
    restoreAll() { for (const label of labels()) restore(label); },
    getConfig() { return Object.assign({}, config); },
    getStats() { return Object.assign({}, stats); }
};

try {
    cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, () => {
        setTimeout(scan, 0);
        setTimeout(scan, 100);
        setTimeout(scan, 500);
    });
} catch (_) {}

restartTimer();
const result = scan();
console.log("[PvZ RU Font Fixer 1.0] installed", config, result);
return result;
})();`, string(cfgJSON))
}

type runtimeEvalResponse struct {
	Result struct {
		Type        string          `json:"type"`
		Value       json.RawMessage `json:"value"`
		Description string          `json:"description"`
	} `json:"result"`
	ExceptionDetails json.RawMessage `json:"exceptionDetails"`
}

type fontFixStats struct {
	Scanned int    `json:"scanned"`
	Matched int    `json:"matched"`
	Changed int    `json:"changed"`
	Href    string `json:"href"`
	Error   string `json:"error"`
}

func evaluate(c *CDPClient, expression string) (runtimeEvalResponse, error) {
	var out runtimeEvalResponse
	err := c.SendCommand("Runtime.evaluate", map[string]any{
		"expression":    expression,
		"awaitPromise":  false,
		"returnByValue": true,
	}, &out)
	if err != nil {
		return out, err
	}
	if len(out.ExceptionDetails) > 0 && string(out.ExceptionDetails) != "null" {
		return out, fmt.Errorf("JavaScript exception: %s", string(out.ExceptionDetails))
	}
	return out, nil
}

func statsFromEval(out runtimeEvalResponse) (fontFixStats, error) {
	var stats fontFixStats
	if len(out.Result.Value) == 0 || string(out.Result.Value) == "null" {
		return stats, errors.New("скрипт не вернул статистику")
	}
	if err := json.Unmarshal(out.Result.Value, &stats); err != nil {
		return stats, fmt.Errorf("не удалось прочитать статистику: %w; value=%s", err, string(out.Result.Value))
	}
	return stats, nil
}

func injectAndVerify(c *CDPClient, cfg Config) (fontFixStats, error) {
	_ = c.SendCommand("Runtime.enable", nil, nil)
	_ = c.SendCommand("Page.enable", nil, nil)

	js := buildInstallerJS(cfg)
	// This only helps if the same WebView navigates later. Runtime.evaluate below
	// applies the patch to the document that is already running.
	_ = c.SendCommand("Page.addScriptToEvaluateOnNewDocument", map[string]any{"source": js}, nil)

	out, err := evaluate(c, js)
	if err != nil {
		return fontFixStats{}, err
	}
	if _, err := statsFromEval(out); err != nil {
		return fontFixStats{}, err
	}

	// Verify that the object really exists in the page after installation.
	verify, err := evaluate(c, `(() => {
		if (!window.__pvzRuFontFix || window.__pvzRuFontFix.version !== 5) return null;
		return window.__pvzRuFontFix.scan();
	})()`)
	if err != nil {
		return fontFixStats{}, err
	}
	verified, err := statsFromEval(verify)
	if err != nil {
		return fontFixStats{}, fmt.Errorf("фикс не появился в странице: %w", err)
	}
	return verified, nil
}

func applyConfigAsync(cfg Config) {
	_ = saveConfig(cfg)
	go func() {
		clientMu.Lock()
		c := client
		clientMu.Unlock()
		if c == nil {
			appendStatus("Настройки сохранены. Они применятся после запуска игры через это приложение.")
			return
		}

		stats, err := injectAndVerify(c, cfg)
		if err != nil {
			appendStatus("Не удалось применить фикс: " + err.Error())
			return
		}
		if stats.Error != "" {
			appendStatus("Фикс подключён, но Cocos сообщил ошибку: " + stats.Error)
			return
		}
		appendStatus(fmt.Sprintf("Применено: найдено %d надписей, кириллица %d, изменено %d.", stats.Scanned, stats.Matched, stats.Changed))
	}()
}

func launchAndFix(cfg Config) {
	if cfg.GamePath == "" {
		appendStatus("Укажите путь к PvZ2.exe.")
		return
	}
	if _, err := os.Stat(cfg.GamePath); err != nil {
		appendStatus("Файл игры не найден: " + cfg.GamePath)
		return
	}
	_ = saveConfig(cfg)
	if launched.Swap(true) {
		appendStatus("Игра уже запущена через это приложение. Используйте «Применить» для изменения настроек.")
		return
	}

	go func() {
		port, err := freePort()
		if err != nil {
			launched.Store(false)
			appendStatus("Не удалось выбрать порт: " + err.Error())
			return
		}
		appendStatus(fmt.Sprintf("Запускаю игру и жду Cocos (порт %d)...", port))

		cmd := exec.Command(cfg.GamePath)
		cmd.Dir = filepath.Dir(cfg.GamePath)
		args := fmt.Sprintf("--remote-debugging-port=%d --remote-debugging-address=127.0.0.1", port)
		cmd.Env = envWithWebView2Args(os.Environ(), args)
		if err := cmd.Start(); err != nil {
			launched.Store(false)
			appendStatus("Не удалось запустить игру: " + err.Error())
			return
		}

		go func() {
			_ = cmd.Wait()
			clientMu.Lock()
			if client != nil {
				client.Close()
				client = nil
			}
			clientMu.Unlock()
			launched.Store(false)
			appendStatus("Игра закрыта.")
		}()

		c, target, probe, err := connectToCocosTarget(port, 35*time.Second)
		if err != nil {
			appendStatus("Игра запущена, но к Cocos подключиться не удалось: " + err.Error())
			return
		}
		appendStatus(fmt.Sprintf("Cocos найден: %s (labels API: %v). Внедряю фикс...", target.URL, probe.HasLabel))

		stats, err := injectAndVerify(c, cfg)
		if err != nil {
			c.Close()
			appendStatus("WebView2 найден, но фикс не выполнился: " + err.Error())
			return
		}

		clientMu.Lock()
		if client != nil {
			client.Close()
		}
		client = c
		clientMu.Unlock()

		if stats.Error != "" {
			appendStatus("Фикс внедрён, но Cocos сообщил ошибку: " + stats.Error)
			return
		}
		appendStatus(fmt.Sprintf("Готово: %d надписей, с кириллицей %d, изменено %d.", stats.Scanned, stats.Matched, stats.Changed))
	}()
}

func envWithWebView2Args(env []string, add string) []string {
	const key = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
	out := make([]string, 0, len(env)+1)
	found := false
	for _, e := range env {
		if i := strings.IndexByte(e, '='); i >= 0 && strings.EqualFold(e[:i], key) {
			value := strings.TrimSpace(e[i+1:])
			if value != "" {
				value += " "
			}
			out = append(out, key+"="+value+add)
			found = true
		} else {
			out = append(out, e)
		}
	}
	if !found {
		out = append(out, key+"="+add)
	}
	return out
}

func freePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

type devTarget struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	Title                string `json:"title"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func listTargets(port int) ([]devTarget, error) {
	clientHTTP := &http.Client{Timeout: 1200 * time.Millisecond}
	resp, err := clientHTTP.Get(fmt.Sprintf("http://127.0.0.1:%d/json/list", port))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("DevTools HTTP %s", resp.Status)
	}
	var targets []devTarget
	if err := json.NewDecoder(resp.Body).Decode(&targets); err != nil {
		return nil, err
	}
	return targets, nil
}

type cocosProbe struct {
	Href        string `json:"href"`
	HasCC       bool   `json:"hasCC"`
	HasDirector bool   `json:"hasDirector"`
	HasLabel    bool   `json:"hasLabel"`
	HasScene    bool   `json:"hasScene"`
}

func probeCocos(c *CDPClient) (cocosProbe, error) {
	out, err := evaluate(c, `(() => ({
		href: location.href,
		hasCC: typeof cc !== "undefined",
		hasDirector: typeof cc !== "undefined" && !!cc.director,
		hasLabel: typeof cc !== "undefined" && !!cc.Label,
		hasScene: typeof cc !== "undefined" && !!cc.director && !!cc.director.getScene()
	}))()`)
	if err != nil {
		return cocosProbe{}, err
	}
	var probe cocosProbe
	if len(out.Result.Value) == 0 {
		return probe, errors.New("пустой ответ Runtime.evaluate")
	}
	if err := json.Unmarshal(out.Result.Value, &probe); err != nil {
		return probe, err
	}
	return probe, nil
}

func connectToCocosTarget(port int, timeout time.Duration) (*CDPClient, devTarget, cocosProbe, error) {
	deadline := time.Now().Add(timeout)
	last := "DevTools ещё не ответил"

	for time.Now().Before(deadline) {
		targets, err := listTargets(port)
		if err != nil {
			last = err.Error()
			time.Sleep(250 * time.Millisecond)
			continue
		}

		// First inspect tauri.localhost pages, then any remaining page target.
		ordered := make([]devTarget, 0, len(targets))
		for _, t := range targets {
			if t.Type == "page" && strings.Contains(t.URL, "tauri.localhost") {
				ordered = append(ordered, t)
			}
		}
		for _, t := range targets {
			if t.Type == "page" && !strings.Contains(t.URL, "tauri.localhost") {
				ordered = append(ordered, t)
			}
		}

		for _, t := range ordered {
			if t.WebSocketDebuggerURL == "" {
				continue
			}
			c, err := DialCDP(t.WebSocketDebuggerURL)
			if err != nil {
				last = fmt.Sprintf("%s: %v", t.URL, err)
				continue
			}
			_ = c.SendCommand("Runtime.enable", nil, nil)
			probe, err := probeCocos(c)
			if err == nil && probe.HasCC && probe.HasDirector && probe.HasLabel && probe.HasScene {
				return c, t, probe, nil
			}
			if err != nil {
				last = fmt.Sprintf("%s: %v", t.URL, err)
			} else {
				last = fmt.Sprintf("%s: cc=%v director=%v label=%v scene=%v", t.URL, probe.HasCC, probe.HasDirector, probe.HasLabel, probe.HasScene)
			}
			c.Close()
		}
		time.Sleep(250 * time.Millisecond)
	}
	return nil, devTarget{}, cocosProbe{}, fmt.Errorf("таймаут ожидания игрового JS; последнее состояние: %s", last)
}

type cdpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type cdpResponse struct {
	ID     int64           `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *cdpError       `json:"error"`
}

type CDPClient struct {
	conn      net.Conn
	br        *bufio.Reader
	writeMu   sync.Mutex
	pendingMu sync.Mutex
	pending   map[int64]chan cdpResponse
	nextID    atomic.Int64
	closed    chan struct{}
	closeOnce sync.Once
}

func DialCDP(rawURL string) (*CDPClient, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "ws" {
		return nil, fmt.Errorf("поддерживается только ws://, получено %s", u.Scheme)
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		host += ":80"
	}
	conn, err := net.DialTimeout("tcp", host, 5*time.Second)
	if err != nil {
		return nil, err
	}

	keyBytes := make([]byte, 16)
	_, _ = rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)
	path := u.RequestURI()
	req := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", path, u.Host, key)
	if _, err := io.WriteString(conn, req); err != nil {
		conn.Close()
		return nil, err
	}

	br := bufio.NewReader(conn)
	status, err := br.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, err
	}
	if !strings.Contains(status, " 101 ") {
		conn.Close()
		return nil, fmt.Errorf("WebSocket handshake: %s", strings.TrimSpace(status))
	}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, err
		}
		if line == "\r\n" {
			break
		}
	}

	c := &CDPClient{
		conn:    conn,
		br:      br,
		pending: make(map[int64]chan cdpResponse),
		closed:  make(chan struct{}),
	}
	go c.readLoop()
	return c, nil
}

func (c *CDPClient) Close() {
	c.closeOnce.Do(func() {
		close(c.closed)
		_ = c.conn.Close()
		c.pendingMu.Lock()
		for id, ch := range c.pending {
			delete(c.pending, id)
			close(ch)
		}
		c.pendingMu.Unlock()
	})
}

func (c *CDPClient) SendCommand(method string, params any, out any) error {
	id := c.nextID.Add(1)
	msg := map[string]any{"id": id, "method": method}
	if params != nil {
		msg["params"] = params
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	ch := make(chan cdpResponse, 1)
	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	if err := c.writeFrame(0x1, data); err != nil {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return err
	}

	select {
	case resp, ok := <-ch:
		if !ok {
			return errors.New("CDP-соединение закрыто")
		}
		if resp.Error != nil {
			return fmt.Errorf("CDP %s: %d %s", method, resp.Error.Code, resp.Error.Message)
		}
		if out != nil && len(resp.Result) > 0 {
			if err := json.Unmarshal(resp.Result, out); err != nil {
				return fmt.Errorf("CDP %s: неверный ответ: %w", method, err)
			}
		}
		return nil
	case <-time.After(6 * time.Second):
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return fmt.Errorf("CDP %s: таймаут ответа", method)
	case <-c.closed:
		return errors.New("CDP-соединение закрыто")
	}
}

func (c *CDPClient) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	select {
	case <-c.closed:
		return errors.New("CDP-соединение закрыто")
	default:
	}
	var b bytes.Buffer
	b.WriteByte(0x80 | opcode)
	n := len(payload)
	if n < 126 {
		b.WriteByte(byte(n) | 0x80)
	} else if n <= 65535 {
		b.WriteByte(126 | 0x80)
		_ = binary.Write(&b, binary.BigEndian, uint16(n))
	} else {
		b.WriteByte(127 | 0x80)
		_ = binary.Write(&b, binary.BigEndian, uint64(n))
	}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	b.Write(mask)
	for i, v := range payload {
		b.WriteByte(v ^ mask[i%4])
	}
	_, err := c.conn.Write(b.Bytes())
	return err
}

func (c *CDPClient) readLoop() {
	defer c.Close()
	var fragmented []byte
	var fragmentedOpcode byte

	for {
		h := make([]byte, 2)
		if _, err := io.ReadFull(c.br, h); err != nil {
			return
		}
		fin := h[0]&0x80 != 0
		opcode := h[0] & 0x0f
		masked := h[1]&0x80 != 0
		length := uint64(h[1] & 0x7f)
		if length == 126 {
			var v uint16
			if err := binary.Read(c.br, binary.BigEndian, &v); err != nil {
				return
			}
			length = uint64(v)
		} else if length == 127 {
			var v uint64
			if err := binary.Read(c.br, binary.BigEndian, &v); err != nil {
				return
			}
			length = v
		}
		if length > 32*1024*1024 {
			return
		}
		var mask []byte
		if masked {
			mask = make([]byte, 4)
			if _, err := io.ReadFull(c.br, mask); err != nil {
				return
			}
		}
		payload := make([]byte, int(length))
		if _, err := io.ReadFull(c.br, payload); err != nil {
			return
		}
		if masked {
			for i := range payload {
				payload[i] ^= mask[i%4]
			}
		}

		switch opcode {
		case 0x8:
			return
		case 0x9:
			_ = c.writeFrame(0xA, payload)
			continue
		case 0x1:
			if !fin {
				fragmentedOpcode = opcode
				fragmented = append(fragmented[:0], payload...)
				continue
			}
		case 0x0:
			if fragmentedOpcode == 0 {
				continue
			}
			fragmented = append(fragmented, payload...)
			if !fin {
				continue
			}
			payload = fragmented
			opcode = fragmentedOpcode
			fragmentedOpcode = 0
			fragmented = nil
		default:
			continue
		}

		if opcode != 0x1 {
			continue
		}
		var resp cdpResponse
		if err := json.Unmarshal(payload, &resp); err != nil || resp.ID == 0 {
			continue
		}
		c.pendingMu.Lock()
		ch := c.pending[resp.ID]
		delete(c.pending, resp.ID)
		c.pendingMu.Unlock()
		if ch != nil {
			ch <- resp
			close(ch)
		}
	}
}

func onCreate(hwnd syscall.Handle) {
	createControl("STATIC", "Полный путь к PvZ2.exe (вставьте вручную):", 0, 16, 16, 330, 20, hwnd, 0)
	hGamePath = createControl("EDIT", "", WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL, 16, 38, 584, 24, hwnd, IDC_GAME_PATH)

	createControl("STATIC", "Шрифт:", 0, 16, 82, 100, 20, hwnd, 0)
	hFont = createControl("COMBOBOX", "", WS_BORDER|WS_TABSTOP|CBS_DROPDOWN|CBS_AUTOHSCROLL, 130, 78, 205, 300, hwnd, IDC_FONT)
	for _, f := range []string{"Segoe UI", "Arial", "Trebuchet MS", "Tahoma", "Verdana", "Calibri"} {
		procSendMessageW.Call(uintptr(hFont), CB_ADDSTRING, 0, uintptr(unsafe.Pointer(utf16Ptr(f))))
	}

	createControl("STATIC", "Размер, %:", 0, 365, 82, 100, 20, hwnd, 0)
	hScale = createControl("EDIT", "90", WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL, 500, 78, 100, 24, hwnd, IDC_SCALE)

	createControl("STATIC", "Интервал между буквами (spacingX):", 0, 16, 122, 245, 20, hwnd, 0)
	hSpacing = createControl("EDIT", "0", WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL, 265, 118, 70, 24, hwnd, IDC_SPACING)

	createControl("STATIC", "Высота строки, %:", 0, 365, 122, 125, 20, hwnd, 0)
	hLineScale = createControl("EDIT", "95", WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL, 500, 118, 100, 24, hwnd, IDC_LINE_SCALE)

	hOnlyCyr = createControl("BUTTON", "Исправлять только надписи с кириллицей", WS_TABSTOP|BS_AUTOCHECKBOX, 16, 158, 300, 24, hwnd, IDC_ONLY_CYR)

	createControl("STATIC", "Важно: уже запущенную обычным способом игру подключить нельзя — запускайте её кнопкой ниже.", 0, 16, 196, 584, 38, hwnd, 0)

	createControl("BUTTON", "Применить", WS_TABSTOP|BS_PUSHBUTTON, 16, 244, 150, 34, hwnd, IDC_APPLY)
	createControl("BUTTON", "Сбросить", WS_TABSTOP|BS_PUSHBUTTON, 178, 244, 150, 34, hwnd, IDC_RESET)
	createControl("BUTTON", "Запустить игру", WS_TABSTOP|BS_PUSHBUTTON, 340, 244, 260, 34, hwnd, IDC_LAUNCH)

	createControl("STATIC", "Статус:", 0, 16, 297, 70, 20, hwnd, 0)
	hStatus = createControl("EDIT", "", WS_BORDER|ES_READONLY|ES_MULTILINE|ES_AUTOVSCROLL, 80, 293, 520, 54, hwnd, IDC_STATUS)

	fillUI(loadConfig())
	procSetTimer.Call(uintptr(hwnd), 1, 100, 0)
	appendStatus("Готово. Вставьте полный путь к PvZ2.exe вручную, затем нажмите «Применить» или «Запустить игру».")
}

func wndProc(hwnd syscall.Handle, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case WM_CREATE:
		hMain = hwnd
		onCreate(hwnd)
		return 0
	case WM_TIMER:
		drainStatus()
		return 0
	case WM_COMMAND:
		switch int(loword(wParam)) {
		case IDC_RESET:
			resetDefaults()
		case IDC_LAUNCH:
			cfg, err := configFromUI()
			if err != nil {
				appendStatus("Ошибка настроек: " + err.Error())
				return 0
			}
			launchAndFix(cfg)
		case IDC_APPLY:
			cfg, err := configFromUI()
			if err != nil {
				appendStatus("Ошибка настроек: " + err.Error())
				return 0
			}
			applyConfigAsync(cfg)
		}
		return 0
	case WM_DESTROY:
		clientMu.Lock()
		if client != nil {
			client.Close()
			client = nil
		}
		clientMu.Unlock()
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(uintptr(hwnd), uintptr(msg), wParam, lParam)
	return r
}

func main() {
	// Win32 windows and their message loop must stay on the same OS thread.
	// Without this Go may migrate the goroutine and Windows marks the UI as hung.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hInst, _, _ := procGetModuleHandleW.Call(0)
	className := utf16Ptr("PvZ2GardendlessFontFixWindow")
	cursor, _, _ := procLoadCursorW.Call(0, 32512) // IDC_ARROW
	wc := WNDCLASSEX{
		CbSize:        uint32(unsafe.Sizeof(WNDCLASSEX{})),
		LpfnWndProc:   syscall.NewCallback(wndProc),
		HInstance:     syscall.Handle(hInst),
		HCursor:       syscall.Handle(cursor),
		HbrBackground: syscall.Handle(COLOR_BTNFACE + 1),
		LpszClassName: className,
	}
	if r, _, _ := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return
	}

	style := uint32(WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX)
	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr(appTitle))),
		uintptr(style),
		uintptr(CW_USEDEFAULT), uintptr(CW_USEDEFAULT),
		640, 410,
		0, 0, hInst, 0,
	)
	if hwnd == 0 {
		return
	}
	procShowWindow.Call(hwnd, SW_SHOW)
	procUpdateWindow.Call(hwnd)

	var msg MSG
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
}
