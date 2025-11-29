/* --- STATE --- */
let baseData = null;
let compsList = [];
let currentId = null;
let viewMode = 'slider'; // 'slider' | 'diff'
let diffColor = { red: 255, green: 0, blue: 255 };
let sensitivity = 'all';
let pz;
let labelTimer = null;

const MODES = ['all', 'colors', 'aa'];

/* --- INIT --- */
$(document).ready(() => {
    const elem = document.getElementById('panzoom-container');
    pz = Panzoom(elem, { maxScale: 15, canvas: true });
    elem.parentElement.addEventListener('wheel', pz.zoomWithWheel);

    initDragDrop();
    setupEventHandlers();
});

function showStatus(msg, autoHide=false) {
    $('#global-status').text(msg).show();
    if(autoHide) setTimeout(() => $('#global-status').fadeOut(), 3000);
}

/* --- DRAG & DROP LOGIC --- */
function initDragDrop() {
    const setupZone = (id, isBase) => {
        const $zone = $(id);
        $zone.on('dragover dragenter', (e) => { e.preventDefault(); e.stopPropagation(); $zone.addClass('drag-over'); });
        $zone.on('dragleave dragend drop', (e) => { e.preventDefault(); e.stopPropagation(); $zone.removeClass('drag-over'); });
        $zone.on('drop', async (e) => {
            const files = e.originalEvent.dataTransfer.files;
            if(files.length > 0) {
                if(isBase) handleBaseFiles([files[0]]);
                else handleCompFiles(files);
            }
        });
    };
    setupZone('#zone-base', true);
    setupZone('#zone-comps', false);
}

/* --- FILE PROCESSING --- */
$('#input-base').change((e) => handleBaseFiles(e.target.files));
$('#input-comps').change((e) => handleCompFiles(e.target.files));

function handleBaseFiles(files) {
    if(!files || !files.length) return;
    const file = files[0];
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
            baseData = { src: e.target.result, w: img.width, h: img.height, name: file.name };
            
            $('#base-name-display').text(`${file.name} (${img.width}x${img.height})`);
            
            // Устанавливаем размеры ТОЛЬКО на обертку.
            $('.wrapper').css({ width: img.width + 'px', height: img.height + 'px' });
            
            // Пересчитываем сравнения если уже есть
            if(compsList.length > 0) await recalculateAllComps();
            
            updateView();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleCompFiles(files) {
    if(!files || !files.length) return;
    showStatus(`Processing ${files.length} new files...`);

    for(let i=0; i<files.length; i++) {
        await addCompImage(files[i]);
    }

    // FIX: Обновляем UI (сортировка + рендер) после добавления всех файлов
    updateListSorted();

    // Если ничего не выбрано, выбираем первое
    if(!currentId && compsList.length > 0) selectComp(compsList[0].id);
    
    showStatus('Done.', true);
}

function addCompImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const src = e.target.result;
            const item = { id: Date.now() + Math.random().toString(), name: file.name, src: src, results: {} };

            if(!baseData) {
                MODES.forEach(m => item.results[m] = { mismatch: 0, diffSrc: null });
                compsList.push(item);
                resolve();
            } else {
                calculateAllModes(baseData.src, src).then(results => {
                    item.results = results;
                    compsList.push(item);
                    resolve();
                });
            }
        };
        reader.readAsDataURL(file);
    });
}

async function calculateAllModes(baseSrc, compSrc) {
    const run = (mode) => new Promise((res) => {
        let r = resemble(baseSrc).compareTo(compSrc);
        if(mode === 'colors') r.ignoreColors();
        if(mode === 'aa') r.ignoreAntialiasing();
        r.onComplete((data) => {
            res({ mismatch: parseFloat(data.misMatchPercentage), diffSrc: data.getImageDataUrl() });
        });
    });

    resemble.outputSettings({ errorColor: diffColor, errorType: 'flat', transparency: 0.3 });
    
    const [rAll, rColors, rAA] = await Promise.all([run('all'), run('colors'), run('aa')]);
    return { all: rAll, colors: rColors, aa: rAA };
}

async function recalculateAllComps() {
    showStatus('Recalculating...');
    for(let item of compsList) {
        item.results = await calculateAllModes(baseData.src, item.src);
    }
    updateListSorted();
    showStatus('Done.', true);
}

/* --- UI LIST --- */
function updateListSorted() {
    // Сортировка по возрастанию % отличий (самые похожие сверху)
    compsList.sort((a, b) => a.results[sensitivity].mismatch - b.results[sensitivity].mismatch);
    renderListHTML();
    $('#comp-count').text(`${compsList.length} items`);
}

function renderListHTML() {
    const $ul = $('#comp-list');
    $ul.empty();
    compsList.forEach((item) => {
        const metric = item.results[sensitivity];
        const isActive = item.id === currentId;
        // Округляем до 2 знаков для красоты
        const scoreVal = metric ? metric.mismatch.toFixed(2) : '0.00';
        
        const html = `
            <li class="comp-item ${isActive ? 'active' : ''}" onclick="selectComp('${item.id}')">
                <button class="btn-del" onclick="deleteComp(event, '${item.id}')">×</button>
                <div class="item-name" title="${item.name}">${item.name}</div>
                <div class="diff-score">${scoreVal}%</div>
            </li>
        `;
        $ul.append(html);
    });
}

window.deleteComp = function(e, id) {
    e.stopPropagation();
    const idx = compsList.findIndex(x => x.id === id);
    if(idx === -1) return;
    
    if(id === currentId) {
        if(compsList.length > 1) {
            const newIdx = idx > 0 ? idx - 1 : idx + 1;
            selectComp(compsList[newIdx].id);
        } else {
            currentId = null;
            $('#comp-img-display').attr('src', '');
            $('#diff-overlay').attr('src', '');
            updateView();
        }
    }
    compsList.splice(idx, 1);
    updateListSorted();
};

window.selectComp = function(id) {
    currentId = id;
    renderListHTML(); // Перерисовка для обновления класса .active
    updateView();
};

/* --- VIEW & SLIDER LOGIC --- */
let lastSliderPct = 50;

function updateView() {
    if(!currentId || !baseData) { 
        $('.img-label').hide(); 
        return; 
    }

    const item = compsList.find(x => x.id === currentId);
    if(!item) return;

    $('#base-img-display').attr('src', baseData.src);
    $('#comp-img-display').attr('src', item.src);
    
    const diffData = item.results[sensitivity].diffSrc;
    $('#diff-overlay').attr('src', diffData || '');

    if (viewMode === 'diff' && diffData) {
        $('#diff-overlay').css('opacity', 1);
        $('#slider-line').hide();
        $('#comp-img-display').css('clip-path', 'none');
        $('#comp-img-display').css('opacity', 1);
    } else {
        $('#diff-overlay').css('opacity', 0);
        $('#comp-img-display').css('opacity', 1);
        applySliderClip(lastSliderPct);
        $('#slider-line').show();
    }
    flashLabels();
}

function applySliderClip(pct) {
    const insetRight = 100 - pct;
    $('#comp-img-display').css('clip-path', `inset(0 ${insetRight}% 0 0)`);
    $('#slider-line').css('left', `${pct}%`);
}

/* --- LABELS LOGIC --- */
function flashLabels(forceState = null) {
    if (!baseData || !currentId) {
        $('.img-label').hide();
        return;
    }

    const item = compsList.find(x => x.id === currentId);
    const baseName = baseData.name;
    const compName = item.name;

    let txtLeft = '', txtRight = '';

    if (forceState === 'hover_swap') {
        txtLeft = compName;
        txtRight = '';
    } else if (forceState === 'hold_swap') {
        txtLeft = '';
        txtRight = baseName;
    } else {
        if (viewMode === 'slider') {
            txtLeft = compName;
            txtRight = baseName;
        } else {
            txtLeft = compName; 
            txtRight = '';
        }
    }

    $('#label-left').text(txtLeft).toggle(!!txtLeft);
    $('#label-right').text(txtRight).toggle(!!txtRight);

    $('.img-label').stop(true, true).css('opacity', 1).show();
    
    if (labelTimer) clearTimeout(labelTimer);
    if (!forceState) {
        labelTimer = setTimeout(() => {
            $('.img-label').fadeOut(500);
        }, 2000);
    }
}

function setupEventHandlers() {
    $('#toggle-settings').click(() => $('#diff-settings').slideToggle(200));

    $('input[name="sens"]').change(function() {
        sensitivity = $(this).val();
        updateListSorted();
        updateView();
    });

    $('.swatch').click(function() {
        $('.swatch').removeClass('selected');
        $(this).addClass('selected');
        const c = $(this).data('color');
        diffColor = { red: c.r, green: c.g, blue: c.b };
        if(currentId && baseData) {
            const item = compsList.find(x => x.id === currentId);
            calculateAllModes(baseData.src, item.src).then(results => {
                item.results = results;
                updateView();
            });
        }
    });

    $('#mode-slider').click(function() {
        viewMode = 'slider';
        $('.btn').removeClass('active'); $(this).addClass('active');
        updateView();
    });

    $('#mode-diff').click(function() {
        viewMode = 'diff';
        $('.btn').removeClass('active'); $(this).addClass('active');
        updateView();
    });

    setupSliderInteraction();
}

/* --- SLIDER & HOLD INTERACTION --- */
function setupSliderInteraction() {
    let isHoldingSwap = false;
    let isHoveringSwap = false;

    const $swapBtn = $('#btn-hold');
    const $compImg = $('#comp-img-display');
    const $diffOverlay = $('#diff-overlay');
    const $sliderLine = $('#slider-line');

    $('.wrapper').mousemove(function(e) {
        if (viewMode !== 'slider' || isHoldingSwap || isHoveringSwap) return;

        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let pct = (x / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        
        lastSliderPct = pct;
        applySliderClip(pct);
    });

    $swapBtn.mouseenter(() => {
        isHoveringSwap = true;
        if (viewMode === 'slider') {
            applySliderClip(100);
            $sliderLine.hide();
        } else if (viewMode === 'diff') {
            $diffOverlay.css('opacity', 0);
            $compImg.css('opacity', 1);
        }
        flashLabels('hover_swap');
    });

    $swapBtn.mouseleave(() => {
        isHoveringSwap = false;
        if (!isHoldingSwap) resetViewToCurrentMode();
    });

    $swapBtn.mousedown((e) => {
        if(e.button !== 0) return;
        isHoldingSwap = true;
        if (viewMode === 'slider') {
            applySliderClip(0);
            $sliderLine.hide();
        } else if (viewMode === 'diff') {
            $diffOverlay.css('opacity', 0);
            $compImg.css('opacity', 0);
        }
        flashLabels('hold_swap');
    });

    $(window).mouseup(() => {
        if(isHoldingSwap) {
            isHoldingSwap = false;
            if ($swapBtn.is(':hover')) {
                isHoveringSwap = true;
                if (viewMode === 'slider') {
                    applySliderClip(100);
                    $sliderLine.hide();
                } else {
                    $diffOverlay.css('opacity', 0);
                    $compImg.css('opacity', 1);
                }
                flashLabels('hover_swap');
            } else {
                resetViewToCurrentMode();
            }
        }
    });

    function resetViewToCurrentMode() {
        flashLabels();
        if (viewMode === 'slider') {
            applySliderClip(lastSliderPct);
            $sliderLine.show();
            $compImg.css('opacity', 1);
            $diffOverlay.css('opacity', 0);
        } else if (viewMode === 'diff') {
            $compImg.css('clip-path', 'none');
            $sliderLine.hide();
            $diffOverlay.css('opacity', 1);
            $compImg.css('opacity', 1);
        }
    }
}
