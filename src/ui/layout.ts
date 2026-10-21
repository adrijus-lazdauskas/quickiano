import { converterAvailable } from "../app/converter";
import { BPM_MIN, PALETTES } from "../app/settings";
import { ICON } from "./icons";
import { S } from "./strings";

const toggle = (id: string, label: string, icon = "") =>
  `<button type="button" class="chip-toggle" id="${id}" aria-pressed="false">${icon}<span>${label}</span></button>`;

const manualSteps = () =>
  `<p>${S.pdfIntro}</p><ol>${S.pdfSteps.map((s) => `<li>${s}</li>`).join("")}</ol><p>${S.pdfOutro}</p>`;

/** Builds the static page; everything dynamic is filled in by the app. */
export function renderLayout(root: HTMLElement): void {
  const conv = converterAvailable();
  root.innerHTML = `
<div class="app" data-state="empty">
  <header class="topbar">
    <a class="brand" href="./" aria-label="${S.appName} home">${ICON.logo}<span>${S.appName}</span></a>
    <div class="song">
      <h1 id="songTitle"></h1>
      <p id="songMeta"></p>
    </div>
    <div class="top-actions">
      <button type="button" class="convert-pill" id="convertPill" aria-label="${S.pillLabel}" hidden><span class="spinner" aria-hidden="true"></span><span id="pillText"></span></button>
      <button type="button" class="btn btn-soft" id="openBtn">${ICON.open}<span>${S.openSong}</span></button>
      <button type="button" class="icon-btn" id="settingsBtn" aria-label="${S.settings}" aria-expanded="false" aria-controls="settingsPanel">${ICON.settings}</button>
    </div>
  </header>

  <section class="timeline" aria-label="Bars">
    <div class="sections" id="sections"></div>
    <div class="bars-wrap"><div class="bars" id="bars"></div></div>
    <div class="timeline-foot">
      <p class="bar-hint" id="barHint" aria-live="polite"></p>
      <div class="legend" aria-hidden="true">
        <span><i class="k-calm"></i>${S.kindShort.calm}</span>
        <span><i class="k-eighths"></i>${S.kindShort.eighths}</span>
        <span><i class="k-sixteenths"></i>${S.kindShort.sixteenths}</span>
        <span><i class="k-lh-only"></i>${S.kindShort["lh-only"]}</span>
      </div>
    </div>
  </section>

  <main class="stage" id="stage">
    <div class="view-host" id="viewHost">
      <div class="count-badge" id="countBadge" hidden></div>
      <p class="sheet-hint" id="sheetHint" hidden>${S.sheetHint}</p>
      <div class="pick-bar" id="pickBar" hidden></div>
    </div>
  </main>

  <footer class="controls">
    <div class="transport">
      <button type="button" class="play-btn" id="playBtn" aria-label="${S.play}">${ICON.play}</button>
      <button type="button" class="icon-btn" id="restartBtn" aria-label="${S.restart}" title="${S.restart}" disabled>${ICON.restart}</button>
    </div>
    <div class="tempo">
      <label for="bpm">${S.tempo}</label>
      <input type="range" id="bpm" min="${BPM_MIN}" max="160" step="2" value="60">
      <output id="bpmOut" for="bpm"></output>
    </div>
    <div class="ctrl-group">
      ${toggle("tLoop", S.loop, ICON.loop)}
      ${toggle("tCount", S.countIn, ICON.count)}
    </div>
    <div class="ctrl-group" role="group" aria-label="${S.hear}">
      <span class="glabel">${S.hear}</span>
      ${toggle("tRight", S.right)}${toggle("tLeft", S.left)}${toggle("tClick", S.click)}
    </div>
    <div class="ctrl-group" role="group" aria-label="${S.show}">
      <span class="glabel">${S.show}</span>
      ${toggle("tNames", S.names)}${toggle("tFingers", S.fingering)}
    </div>
    <div class="seg" role="radiogroup" aria-label="${S.view}" id="viewSeg">
      <button type="button" role="radio" data-view="falling" aria-checked="true">${ICON.falling}<span>${S.viewFalling}</span></button>
      <button type="button" role="radio" data-view="sheet" aria-checked="false">${ICON.sheet}<span>${S.viewSheet}</span></button>
    </div>
  </footer>

  <section class="empty" id="empty">
    <div class="hero">
      <h2>${S.tagline}</h2>
      <p>${S.heroText}</p>
    </div>
    <label class="dropzone" id="dropzone" for="fileIn">
      <span class="dz-icon">${ICON.music}</span>
      <strong>${S.dropTitle}</strong>
      <span>${conv ? S.dropTextPdf : S.dropText}</span>
      <span class="btn btn-accent">${S.browse}</span>
    </label>
    <div class="demos">
      <span class="muted">${S.tryDemo}</span>
      <button type="button" class="btn btn-soft" data-demo="fur-elise.musicxml">Für Elise</button>
      <button type="button" class="btn btn-soft" data-demo="ode-to-joy.musicxml">Ode to Joy</button>
    </div>
    <div class="recent" id="recent" hidden>
      <h3>${S.recent}</h3>
      <ul id="recentList"></ul>
    </div>
    ${
      conv
        ? `<p class="pdf-note">${S.dropNotePdf} <button type="button" class="link" id="pdfBtn">${S.pdfInfoLink}</button></p>`
        : `<button type="button" class="link" id="pdfBtn">${S.onlyPdf}</button>`
    }
    <p class="foot">${S.footer} <a href="https://github.com/adrijus-lazdauskas/quickiano" target="_blank" rel="noopener">${ICON.github}${S.sourceCode}</a></p>
  </section>

  <section class="convert-view" id="convertView" aria-live="polite">
    <div class="cv-card">
      <div class="cv-notes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <h2 id="cvTitle"></h2>
      <p class="cv-file" id="cvFile"></p>
      <div id="cvRunning">
        <div class="cv-bar" aria-hidden="true"><i></i></div>
        <p class="cv-stage"><span id="cvStage"></span> <span class="tnum muted" id="cvTime"></span></p>
        <div class="cv-actions">
          <button type="button" class="btn btn-soft" id="cvDemo">${S.cvDemo}</button>
          <button type="button" class="link" id="cvCancel">${S.cancel}</button>
        </div>
        <p class="cv-note">${S.cvWait}</p>
      </div>
      <div id="cvFailed" hidden>
        <p class="cv-error" id="cvErrorText" role="alert"></p>
        <div class="cv-actions">
          <button type="button" class="btn btn-accent" id="cvRetry">${S.cvRetry}</button>
          <button type="button" class="btn btn-soft" id="cvManual">${S.cvManual}</button>
          <button type="button" class="link" id="cvBack">${S.cvBack}</button>
        </div>
      </div>
    </div>
  </section>

  <aside class="panel" id="settingsPanel" aria-label="${S.settings}" hidden>
    <div class="panel-head">
      <h2>${S.settings}</h2>
      <button type="button" class="icon-btn" id="settingsClose" aria-label="${S.close}">${ICON.close}</button>
    </div>
    <div class="field">
      <h3>${S.view}</h3>
      <div class="seg seg-wide" role="radiogroup" aria-label="${S.view}" id="viewSeg2">
        <button type="button" role="radio" data-view="falling">${S.viewFalling}</button>
        <button type="button" role="radio" data-view="sheet">${S.viewSheet}</button>
      </div>
    </div>
    <div class="field">
      <h3>${S.noteNames}</h3>
      <div class="seg seg-wide seg-3" role="radiogroup" aria-label="${S.noteNames}" id="namingSeg">
        <button type="button" role="radio" data-naming="english">${S.namingEnglish}</button>
        <button type="button" role="radio" data-naming="german">${S.namingGerman}</button>
        <button type="button" role="radio" data-naming="solfege">${S.namingSolfege}</button>
      </div>
    </div>
    <div class="field">
      <h3>${S.colors}</h3>
      <div class="swatches" id="swatches" role="radiogroup" aria-label="${S.colors}">
        ${PALETTES.map(
          (p) =>
            `<button type="button" role="radio" class="swatch" data-palette="${p.id}" aria-label="${p.name}" title="${p.name}" style="--a:${p.right};--b:${p.left}"></button>`,
        ).join("")}
      </div>
      <div class="pickers">
        <label><input type="color" id="rightColor"><span>${S.rightHand}</span></label>
        <label><input type="color" id="leftColor"><span>${S.leftHand}</span></label>
      </div>
    </div>
    <div class="field">
      <label class="switch">
        <input type="checkbox" id="effectsOn">
        <span class="track"></span>
        <span class="switch-label">${S.effects}<small>${S.effectsHint}</small></span>
      </label>
    </div>
    <div class="field about">
      <h3>${S.about}</h3>
      <p>${S.aboutText}</p>
    </div>
  </aside>

  <dialog class="dialog" id="pdfDialog" aria-labelledby="pdfTitle">
    ${
      conv
        ? `<h2 id="pdfTitle">${S.pdfInfoTitle} <span class="beta">${S.beta}</span></h2>
    <ul class="facts">${S.pdfFacts.map((f) => `<li>${f}</li>`).join("")}</ul>
    <details class="manual"><summary>${S.pdfManualTitle}</summary>${manualSteps()}</details>`
        : `<h2 id="pdfTitle">${S.pdfTitle}</h2>${manualSteps()}`
    }
    <form method="dialog"><button class="btn btn-soft">${S.close}</button></form>
  </dialog>

  <input type="file" id="fileIn" class="sr-only" accept=".musicxml,.xml,.mxl,.mid,.midi,.pdf">
  <div class="drop-overlay" aria-hidden="true"><div>${ICON.open}<span>${S.dropOverlay}</span></div></div>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden><span id="toastText"></span><button type="button" class="toast-action" id="toastAction" hidden></button></div>
</div>`;
}
