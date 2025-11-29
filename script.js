/* --- STATE --- */
let baseData = null; 
let compsList = []; 
let currentId = null; 
let viewMode = 'slider'; 
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
            
            $('.wrapper').css({ width: img.width + 'px', height: img.height + 'px' });
            $('#comp-img-display').css('width', img.width + 'px');

            if(compsList.length > 0) await recalculateAllComps();
            updateView();
        }
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleCompFiles(files) {
    if(!files || !files.length) return;
    showStatus(`Processing ${files.length} new files...`);

    for(let i=0; i<files.length; i++) {
        await addCompImage(files[i]);
        showStatus(`Calculated ${i+1}/${files.length}`);
    }
    
    updateListSorted();
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
        const html = `
        <li class="comp-item ${isActive ? 'active' : ''}" onclick="selectComp('${item.id}')">
            <button class="btn-del" onclick="deleteComp(event, '${item.id}')">×</button>
            <div class="item-name" title="${item.name}">${item.name}</div>
            <div class="diff-score">${metric.mismatch}%</div>
        </li>`;
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
            flashLabels();
        }
    }
    compsList.splice(idx, 1);
    updateListSorted();
}

window.selectComp = function(id) {
    currentId = id;
    renderListHTML();
    updateView();
}

$('input[name="sens"]').change(function() {
    sensitivity = $(this).val();
    updateListSorted();
    updateView(); 
});

$('.swatch').click(function() {
    // Visual color switch
    $('.swatch').removeClass('selected');
    $(this).addClass('selected');

    // Update global vars
    const c = $(this).data('color');
    diffColor = { red: c.r, green: c.g, blue: c.b };

    // Recalculate (all, colors, aa)
    if(currentId && baseData) {
        const item = compsList.find(x => x.id === currentId);
        calculateAllModes(baseData.src, item.src).then(results => {
            item.results = results;
            updateView();
        });
    }
});

/* --- VIEW RENDERING --- */
function updateView() {
    if(!currentId || !baseData) { flashLabels(); return; }
    
    const item = compsList.find(x => x.id === currentId);
    if(!item) return;

    $('#base-img-display').attr('src', baseData.src);
    $('#comp-img-display').attr('src', item.src);
    
    const diffData = item.results[sensitivity].diffSrc;
    
    if (viewMode === 'diff' && diffData) {
        $('#diff-overlay').attr('src', diffData).css('opacity', 1);
        $('#comp-layer').css('opacity', 0); 
    } else {
        $('#diff-overlay').css('opacity', 0);
        $('#comp-layer').css('opacity', 1);
    }
    
    flashLabels(); // Show labels for 2 seconds
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
        // Showing COMP full
        txtLeft = compName; 
        txtRight = ''; 
    } else if (forceState === 'hold_swap') {
        // Showing BASE full
        txtLeft = '';
        txtRight = baseName;
    } else {
        // Normal Mode
        if (viewMode === 'slider') {
            txtLeft = compName;
            txtRight = baseName;
        } else {
            txtLeft = compName; // Diff doesn't show base
            txtRight = '';
        }
    }

    // Apply Text
    $('#label-left').text(txtLeft).toggle(!!txtLeft);
    $('#label-right').text(txtRight).toggle(!!txtRight);

    // Visibility Logic
    $('.img-label').stop(true, true).css('opacity', 1).show();

    if (labelTimer) clearTimeout(labelTimer);
    
    // If forceState is active (interacting), keep shown. Else fade out.
    if (!forceState) {
        labelTimer = setTimeout(() => {
            $('.img-label').fadeOut(500);
        }, 2000);
    }
}

function setupEventHandlers() {
    $('#toggle-settings').click(() => $('#diff-settings').slideToggle(200));
    
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
    let lastSliderPct = 50;
    let isHoldingSwap = false;
    let isHoveringSwap = false;
    
    const $swapBtn = $('#btn-hold');
    const $sliderLayer = $('#comp-layer');
    const $diffOverlay = $('#diff-overlay');

    // SLIDER MOVE
    $('.wrapper').mousemove(function(e) {
        if (viewMode !== 'slider' || isHoldingSwap || isHoveringSwap) return;
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let pct = (x / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        lastSliderPct = pct;
        $sliderLayer.css('width', pct + '%');
    });

    // HOVER (Show COMP)
    $swapBtn.mouseenter(() => {
        isHoveringSwap = true;
        $sliderLayer.addClass('no-border');
        
        if (viewMode === 'slider') {
            $sliderLayer.css('width', '100%');
        } else if (viewMode === 'diff') {
            $diffOverlay.css('opacity', 0);
            $sliderLayer.css('opacity', 1);
            $sliderLayer.css('width', '100%');
        }
        flashLabels('hover_swap');
    });

    $swapBtn.mouseleave(() => {
        isHoveringSwap = false;
        if (!isHoldingSwap) resetView();
    });

    // HOLD (Show BASE)
    $swapBtn.mousedown((e) => {
        if(e.button !== 0) return;
        isHoldingSwap = true;
        $sliderLayer.addClass('no-border');
        
        // Hide Comp -> Show Base
        if (viewMode === 'slider') {
            $sliderLayer.css('width', '0%');
        } else if (viewMode === 'diff') {
            $diffOverlay.css('opacity', 0);
            $sliderLayer.css('opacity', 1);
            $sliderLayer.css('width', '0%');
        }
        flashLabels('hold_swap');
    });

    $(window).mouseup(() => {
        if(isHoldingSwap) {
            isHoldingSwap = false;
            // If still hovering, return to Hover state (Full Comp)
            if ($swapBtn.is(':hover')) {
                isHoveringSwap = true;
                if (viewMode === 'slider') {
                    $sliderLayer.css('width', '100%');
                } else if (viewMode === 'diff') {
                    $diffOverlay.css('opacity', 0);
                    $sliderLayer.css('opacity', 1);
                    $sliderLayer.css('width', '100%');
                }
                flashLabels('hover_swap');
            } else {
                resetView();
            }
        }
    });

    function resetView() {
        $sliderLayer.removeClass('no-border');
        flashLabels(); // Trigger fade out
        
        if (viewMode === 'slider') {
            $sliderLayer.css('width', lastSliderPct + '%');
            $sliderLayer.css('opacity', 1);
            $diffOverlay.css('opacity', 0);
        } else if (viewMode === 'diff') {
            $diffOverlay.css('opacity', 1);
            $sliderLayer.css('opacity', 0);
        }
    }
}
