package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestInstallerEmbedsConfigAsJSONAndUsesRichTextVersion(t *testing.T) {
	cfg := defaultConfig()
	cfg.FontFamily = "Font \"quoted\"\nname"
	js := buildInstallerJS(cfg)
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(js, "const incoming = "+string(encoded)+";") {
		t.Fatal("configuration was not embedded as JSON")
	}
	if strings.Contains(js, "__CONFIG_JSON__") || strings.Contains(js, "__FONT_ASSETS_JSON__") || strings.Contains(js, "__OBJECTIVE_TRANSLATIONS_JSON__") {
		t.Fatal("unexpanded configuration placeholder")
	}
	if !strings.Contains(js, fmt.Sprintf("const VERSION = %d;", installerVersion)) || !strings.Contains(js, "cc.RichText") {
		t.Fatal("wrong installer version or missing RichText support")
	}
	if strings.Contains(js, "__UI_TRANSLATIONS_JSON__") || !strings.Contains(js, "Fast Shovel") {
		t.Fatal("UI translation map was not embedded")
	}
	if strings.Contains(js, "__DOCUMENT_TRANSLATIONS_JSON__") || !strings.Contains(js, "Частые вопросы") {
		t.Fatal("game document translations were not embedded")
	}
	var fonts []struct { Label string `json:"label"`; Family string `json:"family"`; Source string `json:"source"` }
	if err := json.Unmarshal([]byte(fontAssetsJSON), &fonts); err != nil || len(fonts) != 3 { t.Fatal("expected three embedded fonts", err) }
	for _, font := range fonts { if !strings.HasPrefix(font.Source, "url(data:font/ttf;base64,") || !strings.Contains(js,font.Family) { t.Fatal("invalid font embedding",font.Label) } }
}
