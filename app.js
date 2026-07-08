/* ====================================
   SAILING RACE START LINE APP - LOGIC
   Main application state, GPS tracking, distance calculations, and UI updates
   ==================================== */

// =============================================================================
// APPLICATION STATE OBJECT
// Maintains all state for the race: GPS positions, distances, timers, etc.
// =============================================================================
const state = {
    // Start boat position (first GPS point marking the start of the startline)
    startboat: null,

    // Line end position (second GPS point marking the other end of startline)
    lineEnd: null,

    // Current GPS position of the boat
    currentPosition: null,

    // Perpendicular distance from current position to the startline (in meters)
    distance: null,

    // Side of the startline that is treated as pre-start (positive distance)
    preStartSideSign: null,

    // Boat speed extracted from GPS data (in knots)
    boatSpeed: null,

    // Boat heading/bearing from GPS data (in degrees, 0-360)
    bearing: null,

    // Raw GPS speed and bearing values used for diagnostics and trust checks
    gpsBoatSpeed: null,
    gpsBearing: null,

    // Sliding-window speed and bearing derived from recent positions
    derivedBoatSpeed: null,
    derivedBearing: null,

    // Track what is being displayed so fallback values can be styled in red
    speedDisplaySource: 'none',
    bearingDisplaySource: 'none',

    // Last observed GPS position accuracy in meters (95% confidence radius)
    positionAccuracyM: null,

    // Circular buffer of recent position fixes for boxcar-style motion estimates
    positionHistory: [],

    // Tracking for frozen-heading detection
    lastRawBearing: null,
    lastRawBearingChangeTime: null,

    // Quality indicators shown in UI
    gpsQualityLevel: 'yellow',
    gpsQualityText: 'GPS quality: Waiting for fix',
    motionQualityLevel: 'yellow',
    motionQualityText: 'Motion trust: Waiting for data',

    // Remaining countdown time before start (milliseconds)
    countdownRemainingMs: 5 * 60 * 1000,

    // Whether countdown is currently running (pre-start)
    countdownRunning: false,

    // Timestamp of the last countdown tick for accurate decrementing
    countdownLastTickTime: null,

    // Whether the race has officially started (countdown reached zero)
    raceStarted: false,

    // Timestamp when race time started (T=0)
    raceStartTime: null,

    // GPS status: 'initializing', 'acquiring', 'ready', or 'error'
    gpsStatus: 'initializing',

    // Timestamp of the last successful GPS position fix
    lastPositionTimestamp: null,

    // Geolocation watchId (needed to stop watching GPS updates)
    watchId: null,

    // Interval ID used to update countdown/elapsed timer
    timerIntervalId: null,

    // Interval ID used to refresh data quality state even if no new GPS fix arrives
    qualityIntervalId: null
};

const KNOTS_PER_MPS = 1 / 0.51444;
const MOTION_WINDOW_MAX_POINTS = 8;
const MOTION_WINDOW_MIN_POINTS = 3;
const MIN_TRUSTED_SPEED_FOR_BEARING_KNOTS = 1.2;
const FRESH_FIX_GREEN_MS = 3000;
const FRESH_FIX_RED_MS = 10000;
const ACCURACY_GREEN_M = 15;
const ACCURACY_RED_M = 35;
const MAX_SPEED_DELTA_KNOTS = 2.0;
const MAX_SPEED_DELTA_RATIO = 0.45;
const MAX_BEARING_DELTA_DEG = 35;
const HEADING_FREEZE_MS = 5000;
const HEADING_TURN_RATE_ALERT_DEG_PER_SEC = 18;
const DERIVED_FALLBACK_MAX_ACCURACY_M = 12;
const DERIVED_FALLBACK_MIN_SEGMENTS = 3;
const DERIVED_MAX_SPEED_STDDEV_KNOTS = 1.2;
const DERIVED_MAX_BEARING_SPREAD_DEG = 28;

// =============================================================================
// DOM ELEMENT REFERENCES
// Cache frequently accessed DOM elements for performance
// =============================================================================
const elements = {
    // Buttons
    markStartBoatBtn: document.getElementById('markStartBoatBtn'),
    markLineEndBtn: document.getElementById('markLineEndBtn'),
    startCountdownBtn: document.getElementById('startCountdownBtn'),
    syncCountdownBtn: document.getElementById('syncCountdownBtn'),
    resetCountdownBtn: document.getElementById('resetCountdownBtn'),

    // Status displays
    gpsStatus: document.getElementById('gpsStatus'),
    gpsQualityDot: document.getElementById('gpsQualityDot'),
    gpsQualityText: document.getElementById('gpsQualityText'),
    motionQualityDot: document.getElementById('motionQualityDot'),
    motionQualityText: document.getElementById('motionQualityText'),
    startBoatStatus: document.getElementById('startBoatStatus'),
    lineEndStatus: document.getElementById('lineEndStatus'),
    currentPosInfo: document.getElementById('currentPosInfo'),
    lastPositionTime: document.getElementById('lastPositionTime'),

    // Metric value displays
    distanceValue: document.getElementById('distanceValue'),
    speedValue: document.getElementById('speedValue'),
    bearingValue: document.getElementById('bearingValue'),
    timerValue: document.getElementById('timerValue')
};

// =============================================================================
// INITIALIZATION FUNCTION
// Sets up event listeners, starts GPS tracking, and initializes the app
// Called once when the page loads
// =============================================================================
function initializeApp() {
    console.log('Initializing Sailing Race Start App...');

    // Attach event listeners to buttons
    elements.markStartBoatBtn.addEventListener('click', markStartBoatPosition);
    elements.markLineEndBtn.addEventListener('click', markLineEndPosition);
    elements.startCountdownBtn.addEventListener('click', toggleCountdown);
    elements.syncCountdownBtn.addEventListener('click', syncCountdown);
    elements.resetCountdownBtn.addEventListener('click', resetCountdown);

    // Start continuous GPS tracking
    initializeGPSTracking();

    // Refresh quality indicators even if GPS updates pause, so stale data turns red.
    startQualityLoop();

    // Initialize button state before any positions have been marked
    updatePositionStatusDisplay();
    updateCountdownDisplay();
    updateCountdownControls();

    console.log('App initialization complete');
}

function startQualityLoop() {
    if (state.qualityIntervalId !== null) {
        return;
    }

    state.qualityIntervalId = setInterval(function () {
        refreshDataQuality();
        updateUIDisplay();
    }, 1000);
}

// =============================================================================
// GPS TRACKING INITIALIZATION
// Sets up continuous GPS position monitoring using the browser Geolocation API
// Updates state with position, speed, and bearing data whenever GPS location changes
// =============================================================================
function initializeGPSTracking() {
    // Check if browser supports Geolocation API
    if (!navigator.geolocation) {
        updateGPSStatus('error');
        console.error('Geolocation API not supported by this browser');
        return;
    }

    updateGPSStatus('acquiring');

    // Options for GPS tracking:
    // - enableHighAccuracy: true - use more accurate GPS (higher battery drain)
    // - timeout: 10000 - wait max 10 seconds for a position
    // - maximumAge: 0 - don't use cached position, always get fresh data
    const geoOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };

    // watchPosition() continuously monitors location changes
    // Calls onPositionSuccess when position updates, onPositionError if an error occurs
    state.watchId = navigator.geolocation.watchPosition(
        onPositionSuccess,
        onPositionError,
        geoOptions
    );
}

// =============================================================================
// GPS SUCCESS CALLBACK
// Executes whenever GPS position is successfully updated
// Extracts lat, lon, speed, and bearing from GPS data and updates state
// Recalculates distance to startline and updates UI
// =============================================================================
function onPositionSuccess(position) {
    // Extract GPS coordinates and accuracy data
    const coords = position.coords;

    // Update state with current position
    state.currentPosition = {
        lat: coords.latitude,
        lon: coords.longitude
    };
    state.lastPositionTimestamp = position.timestamp || Date.now();
    state.positionAccuracyM = typeof coords.accuracy === 'number' ? coords.accuracy : null;

    addPositionToHistory({
        lat: state.currentPosition.lat,
        lon: state.currentPosition.lon,
        timestamp: state.lastPositionTimestamp
    });

    // Extract boat speed from GPS (in m/s, convert to knots: m/s ÷ 0.51444)
    // If GPS doesn't provide speed data, set to null
    state.gpsBoatSpeed = coords.speed !== null ? coords.speed * KNOTS_PER_MPS : null;

    // Extract bearing/heading from GPS (in degrees, 0-360)
    // If GPS doesn't provide heading, set to null
    state.gpsBearing = coords.heading !== null ? normalizeBearing(coords.heading) : null;

    trackRawBearingChanges();

    const derivedMotion = calculateDerivedMotionFromHistory();
    state.derivedBoatSpeed = derivedMotion ? derivedMotion.speedKnots : null;
    state.derivedBearing = derivedMotion ? derivedMotion.bearingDeg : null;

    applyMotionTrustFiltering(derivedMotion);
    refreshDataQuality(derivedMotion);

    // Update GPS status to "ready" since we have successfully acquired position
    if (state.gpsStatus !== 'ready') {
        updateGPSStatus('ready');
    }

    // If both startline endpoints are set, calculate distance to the startline
    if (state.startboat && state.lineEnd) {
        calculateDistanceToStartline();
    }

    // Update all UI displays with new data
    updateUIDisplay();

    console.log('GPS Update:', {
        lat: state.currentPosition.lat.toFixed(6),
        lon: state.currentPosition.lon.toFixed(6),
        accuracyM: state.positionAccuracyM !== null ? state.positionAccuracyM.toFixed(1) : 'N/A',
        gpsSpeed: state.gpsBoatSpeed !== null ? state.gpsBoatSpeed.toFixed(2) : 'N/A',
        gpsBearing: state.gpsBearing !== null ? state.gpsBearing.toFixed(1) : 'N/A',
        derivedSpeed: state.derivedBoatSpeed !== null ? state.derivedBoatSpeed.toFixed(2) : 'N/A',
        derivedBearing: state.derivedBearing !== null ? state.derivedBearing.toFixed(1) : 'N/A',
        trustedSpeed: state.boatSpeed !== null ? state.boatSpeed.toFixed(2) : 'N/A',
        trustedBearing: state.bearing !== null ? state.bearing.toFixed(1) : 'N/A'
    });
}

function normalizeBearing(degrees) {
    const normalized = ((degrees % 360) + 360) % 360;
    return normalized === 360 ? 0 : normalized;
}

function shortestAngularDifference(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
}

function degreesToRadians(degrees) {
    return degrees * (Math.PI / 180);
}

function radiansToDegrees(radians) {
    return radians * (180 / Math.PI);
}

function calculateDistanceMeters(pointA, pointB) {
    const earthRadiusM = 6371000;
    const lat1 = degreesToRadians(pointA.lat);
    const lat2 = degreesToRadians(pointB.lat);
    const deltaLat = degreesToRadians(pointB.lat - pointA.lat);
    const deltaLon = degreesToRadians(pointB.lon - pointA.lon);

    const sinLat = Math.sin(deltaLat / 2);
    const sinLon = Math.sin(deltaLon / 2);
    const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusM * c;
}

function calculateInitialBearing(pointA, pointB) {
    const lat1 = degreesToRadians(pointA.lat);
    const lat2 = degreesToRadians(pointB.lat);
    const deltaLon = degreesToRadians(pointB.lon - pointA.lon);

    const y = Math.sin(deltaLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

    return normalizeBearing(radiansToDegrees(Math.atan2(y, x)));
}

function addPositionToHistory(sample) {
    state.positionHistory.push(sample);
    if (state.positionHistory.length > MOTION_WINDOW_MAX_POINTS) {
        state.positionHistory.shift();
    }
}

function calculateDerivedMotionFromHistory() {
    if (state.positionHistory.length < MOTION_WINDOW_MIN_POINTS) {
        return null;
    }

    const points = state.positionHistory;
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    const elapsedSeconds = (lastPoint.timestamp - firstPoint.timestamp) / 1000;

    if (elapsedSeconds <= 0.5) {
        return null;
    }

    let totalDistanceM = 0;
    const segmentBearings = [];
    const segmentSpeedsKnots = [];

    for (let i = 1; i < points.length; i += 1) {
        const segmentDistance = calculateDistanceMeters(points[i - 1], points[i]);
        totalDistanceM += segmentDistance;
        if (segmentDistance >= 2) {
            segmentBearings.push(calculateInitialBearing(points[i - 1], points[i]));
        }

        const segmentElapsedSeconds = (points[i].timestamp - points[i - 1].timestamp) / 1000;
        if (segmentElapsedSeconds > 0.2) {
            const segmentSpeedKnots = (segmentDistance / segmentElapsedSeconds) * 1.943844;
            segmentSpeedsKnots.push(segmentSpeedKnots);
        }
    }

    const speedKnots = (totalDistanceM / elapsedSeconds) * 1.943844;
    const bearingDeg = calculateInitialBearing(firstPoint, lastPoint);

    let turnRateDegPerSec = 0;
    if (segmentBearings.length >= 2) {
        let accumulatedTurn = 0;
        for (let i = 1; i < segmentBearings.length; i += 1) {
            accumulatedTurn += shortestAngularDifference(segmentBearings[i], segmentBearings[i - 1]);
        }
        turnRateDegPerSec = accumulatedTurn / elapsedSeconds;
    }

    const speedStdDevKnots = calculateStdDev(segmentSpeedsKnots);
    const bearingSpreadDeg = calculateAngularSpread(segmentBearings);

    return {
        speedKnots,
        bearingDeg,
        elapsedSeconds,
        turnRateDegPerSec,
        speedStdDevKnots,
        bearingSpreadDeg,
        segmentCount: segmentSpeedsKnots.length
    };
}

function calculateStdDev(values) {
    if (!values || values.length < 2) {
        return 0;
    }

    const mean = values.reduce(function (sum, value) {
        return sum + value;
    }, 0) / values.length;

    const variance = values.reduce(function (sum, value) {
        const delta = value - mean;
        return sum + (delta * delta);
    }, 0) / values.length;

    return Math.sqrt(variance);
}

function calculateAngularSpread(angles) {
    if (!angles || angles.length < 2) {
        return 0;
    }

    let maxGap = 0;
    const sorted = angles
        .map(function (angle) {
            return normalizeBearing(angle);
        })
        .sort(function (a, b) {
            return a - b;
        });

    for (let i = 1; i < sorted.length; i += 1) {
        maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
    }
    maxGap = Math.max(maxGap, (sorted[0] + 360) - sorted[sorted.length - 1]);

    return 360 - maxGap;
}

function canUseDerivedFallback(derivedMotion) {
    if (!derivedMotion) {
        return false;
    }

    if (state.gpsQualityLevel === 'red') {
        return false;
    }

    if (state.positionAccuracyM === null || state.positionAccuracyM > DERIVED_FALLBACK_MAX_ACCURACY_M) {
        return false;
    }

    if (derivedMotion.segmentCount < DERIVED_FALLBACK_MIN_SEGMENTS) {
        return false;
    }

    if (derivedMotion.speedStdDevKnots > DERIVED_MAX_SPEED_STDDEV_KNOTS) {
        return false;
    }

    if (derivedMotion.bearingSpreadDeg > DERIVED_MAX_BEARING_SPREAD_DEG) {
        return false;
    }

    return true;
}

function trackRawBearingChanges() {
    if (state.gpsBearing === null) {
        return;
    }

    const now = Date.now();
    if (state.lastRawBearing === null) {
        state.lastRawBearing = state.gpsBearing;
        state.lastRawBearingChangeTime = now;
        return;
    }

    if (shortestAngularDifference(state.gpsBearing, state.lastRawBearing) > 0.2) {
        state.lastRawBearing = state.gpsBearing;
        state.lastRawBearingChangeTime = now;
    }
}

function applyMotionTrustFiltering(derivedMotion) {
    const rawSpeed = state.gpsBoatSpeed;
    const rawBearing = state.gpsBearing;
    const derivedSpeed = state.derivedBoatSpeed;
    const derivedBearing = state.derivedBearing;

    const hasRawSpeed = rawSpeed !== null && Number.isFinite(rawSpeed);
    const hasRawBearing = rawBearing !== null && Number.isFinite(rawBearing);
    const hasDerived = derivedMotion && derivedSpeed !== null && derivedBearing !== null;
    const derivedFallbackAllowed = canUseDerivedFallback(derivedMotion);

    state.speedDisplaySource = 'none';
    state.bearingDisplaySource = 'none';

    const speedDelta = hasRawSpeed && hasDerived
        ? Math.abs(rawSpeed - derivedSpeed)
        : null;

    const allowedSpeedDelta = hasDerived
        ? Math.max(MAX_SPEED_DELTA_KNOTS, derivedSpeed * MAX_SPEED_DELTA_RATIO)
        : MAX_SPEED_DELTA_KNOTS;

    const speedTrusted = hasRawSpeed && (
        !hasDerived || speedDelta <= allowedSpeedDelta
    );

    const bearingDelta = hasRawBearing && hasDerived
        ? shortestAngularDifference(rawBearing, derivedBearing)
        : null;

    const sharpTurnDetected = Boolean(derivedMotion) &&
        derivedMotion.turnRateDegPerSec > HEADING_TURN_RATE_ALERT_DEG_PER_SEC;

    const freezeDetected = Boolean(state.lastRawBearingChangeTime) && Boolean(derivedMotion) &&
        (Date.now() - state.lastRawBearingChangeTime) > HEADING_FREEZE_MS &&
        derivedMotion.speedKnots >= MIN_TRUSTED_SPEED_FOR_BEARING_KNOTS &&
        shortestAngularDifference(rawBearing || 0, derivedBearing || 0) > MAX_BEARING_DELTA_DEG;

    const bearingTrusted = hasRawBearing &&
        hasRawSpeed &&
        rawSpeed >= MIN_TRUSTED_SPEED_FOR_BEARING_KNOTS &&
        !sharpTurnDetected &&
        !freezeDetected &&
        (!hasDerived || bearingDelta <= MAX_BEARING_DELTA_DEG);

    if (speedTrusted) {
        state.boatSpeed = rawSpeed;
        state.speedDisplaySource = 'gps';
    } else if (!hasRawSpeed && hasDerived && derivedFallbackAllowed) {
        state.boatSpeed = derivedSpeed;
        state.speedDisplaySource = 'derived';
    } else {
        state.boatSpeed = null;
    }

    if (bearingTrusted) {
        state.bearing = rawBearing;
        state.bearingDisplaySource = 'gps';
    } else if (!hasRawBearing && hasDerived && derivedFallbackAllowed && derivedSpeed >= MIN_TRUSTED_SPEED_FOR_BEARING_KNOTS) {
        state.bearing = derivedBearing;
        state.bearingDisplaySource = 'derived';
    } else {
        state.bearing = null;
    }

    if (!speedTrusted && hasDerived && derivedFallbackAllowed) {
        state.boatSpeed = derivedSpeed;
        state.speedDisplaySource = 'derived';
    }

    if (!bearingTrusted && hasDerived && derivedFallbackAllowed && derivedSpeed >= MIN_TRUSTED_SPEED_FOR_BEARING_KNOTS) {
        state.bearing = derivedBearing;
        state.bearingDisplaySource = 'derived';
    }

    if (state.gpsQualityLevel === 'red') {
        state.boatSpeed = null;
        state.bearing = null;
        state.speedDisplaySource = 'none';
        state.bearingDisplaySource = 'none';
    }

    if (state.gpsQualityLevel === 'red') {
        state.motionQualityLevel = 'red';
        state.motionQualityText = 'Motion trust: Bad (GPS lock/freshness issue)';
        return;
    }

    if (state.boatSpeed !== null && state.bearing !== null) {
        if (state.speedDisplaySource === 'derived' || state.bearingDisplaySource === 'derived') {
            state.motionQualityLevel = 'yellow';
            state.motionQualityText = 'Motion trust: Caution (showing derived fallback in red)';
        } else {
            state.motionQualityLevel = 'green';
            state.motionQualityText = 'Motion trust: Good';
        }
        return;
    }

    const speedIsBad = state.boatSpeed === null;
    const bearingIsBad = state.bearing === null;

    if (sharpTurnDetected) {
        state.motionQualityLevel = 'yellow';
        state.motionQualityText = 'Motion trust: Caution (sharp turn in window)';
        return;
    }

    if (freezeDetected) {
        state.motionQualityLevel = 'yellow';
        state.motionQualityText = 'Motion trust: Caution (bearing appears frozen)';
        return;
    }

    if (speedIsBad && bearingIsBad) {
        state.motionQualityLevel = 'yellow';
        if (hasDerived && !derivedFallbackAllowed) {
            state.motionQualityText = 'Motion trust: Caution (derived data too variable to show)';
        } else {
            state.motionQualityText = 'Motion trust: Caution (speed/bearing filtered)';
        }
        return;
    }

    if (bearingIsBad) {
        state.motionQualityLevel = 'yellow';
        state.motionQualityText = 'Motion trust: Caution (bearing filtered)';
        return;
    }

    state.motionQualityLevel = 'yellow';
    state.motionQualityText = 'Motion trust: Caution (speed filtered)';
}

function refreshDataQuality() {
    const now = Date.now();
    const hasFix = state.lastPositionTimestamp !== null;
    const fixAgeMs = hasFix ? (now - state.lastPositionTimestamp) : Infinity;
    const accuracyM = state.positionAccuracyM;

    if (!hasFix || state.gpsStatus === 'error' || fixAgeMs > FRESH_FIX_RED_MS) {
        state.gpsQualityLevel = 'red';
        state.gpsQualityText = 'GPS quality: Bad (stale or no lock)';
    } else if (state.gpsStatus !== 'ready') {
        state.gpsQualityLevel = 'yellow';
        state.gpsQualityText = 'GPS quality: Acquiring lock';
    } else if (accuracyM === null) {
        state.gpsQualityLevel = 'yellow';
        state.gpsQualityText = 'GPS quality: Unknown accuracy';
    } else if (accuracyM <= ACCURACY_GREEN_M && fixAgeMs <= FRESH_FIX_GREEN_MS) {
        state.gpsQualityLevel = 'green';
        state.gpsQualityText = `GPS quality: Good (accuracy ${accuracyM.toFixed(1)} m)`;
    } else if (accuracyM >= ACCURACY_RED_M) {
        state.gpsQualityLevel = 'red';
        state.gpsQualityText = `GPS quality: Bad (accuracy ${accuracyM.toFixed(1)} m)`;
    } else {
        state.gpsQualityLevel = 'yellow';
        state.gpsQualityText = `GPS quality: Caution (accuracy ${accuracyM.toFixed(1)} m)`;
    }

    if (state.gpsQualityLevel === 'red') {
        state.boatSpeed = null;
        state.bearing = null;
        state.speedDisplaySource = 'none';
        state.bearingDisplaySource = 'none';
        state.motionQualityLevel = 'red';
        state.motionQualityText = 'Motion trust: Bad (GPS lock/freshness issue)';
    }
}

function updateQualityIndicators() {
    elements.gpsQualityText.textContent = state.gpsQualityText;
    elements.motionQualityText.textContent = state.motionQualityText;

    elements.gpsQualityDot.className = `quality-dot ${state.gpsQualityLevel}`;
    elements.motionQualityDot.className = `quality-dot ${state.motionQualityLevel}`;
}

// =============================================================================
// GPS ERROR CALLBACK
// Executes if GPS tracking encounters an error (permission denied, timeout, etc.)
// =============================================================================
function onPositionError(error) {
    let errorMessage = 'Unknown GPS error';

    // Map specific error codes to user-friendly messages
    if (error.code === error.PERMISSION_DENIED) {
        errorMessage = 'Location permission denied. Please enable location access.';
    } else if (error.code === error.POSITION_UNAVAILABLE) {
        errorMessage = 'Location data not available.';
    } else if (error.code === error.TIMEOUT) {
        errorMessage = 'GPS acquisition timeout. Retrying...';
    }

    console.error('GPS Error:', errorMessage);
    updateGPSStatus('error');
}

// =============================================================================
// MARK START BOAT POSITION FUNCTION
// Saves the current GPS position as one end of the startline (typically where
// the starting boat/committee boat is anchored)
// =============================================================================
function markStartBoatPosition() {
    // Check if we have a current position to mark
    if (!state.currentPosition) {
        alert('Waiting for GPS position...');
        return;
    }

    // Store the current position as the start boat location
    state.startboat = {
        lat: state.currentPosition.lat,
        lon: state.currentPosition.lon
    };
    state.preStartSideSign = null;

    console.log('Start boat position marked:', state.startboat);

    // Update UI to show that start boat position is now set
    updatePositionStatusDisplay();

    // Check if both positions are now set; if so, enable the Start Countdown button
    checkAndEnableCountdownButton();

    // Recalculate immediately so distance appears without waiting for next GPS update
    if (state.lineEnd) {
        calculateDistanceToStartline();
        updateUIDisplay();
    }
}

// =============================================================================
// MARK LINE END POSITION FUNCTION
// Saves the current GPS position as the other end of the startline (typically
// where the leeward marker/buoy is anchored)
// =============================================================================
function markLineEndPosition() {
    // Check if we have a current position to mark
    if (!state.currentPosition) {
        alert('Waiting for GPS position...');
        return;
    }

    // Store the current position as the line end location
    state.lineEnd = {
        lat: state.currentPosition.lat,
        lon: state.currentPosition.lon
    };
    state.preStartSideSign = null;

    console.log('Line end position marked:', state.lineEnd);

    // Update UI to show that line end position is now set
    updatePositionStatusDisplay();

    // Check if both positions are now set; if so, enable the Start Countdown button
    checkAndEnableCountdownButton();

    // Recalculate immediately so distance appears without waiting for next GPS update
    if (state.startboat) {
        calculateDistanceToStartline();
        updateUIDisplay();
    }
}

// =============================================================================
// CHECK AND ENABLE COUNTDOWN BUTTON
// Keeps the countdown button available regardless of whether startline points
// have been marked yet, so the race timer can be started immediately.
// =============================================================================
function checkAndEnableCountdownButton() {
    updateCountdownControls();
}

// =============================================================================
// CALCULATE DISTANCE TO STARTLINE FUNCTION
// Uses turf.js to calculate the perpendicular distance from the current boat
// position to the startline (defined by startboat and lineEnd points)
// Formula: perpendicular distance from a point to a line segment
// =============================================================================
function calculateDistanceToStartline() {
    // Verify we have all required data
    if (!state.startboat || !state.lineEnd || !state.currentPosition) {
        state.distance = null;
        return;
    }

    try {
        // Create a turf.js line feature from the two startline endpoints
        // turf.lineString expects coordinates as [lon, lat] (GeoJSON standard)
        const startline = turf.lineString([
            [state.startboat.lon, state.startboat.lat],
            [state.lineEnd.lon, state.lineEnd.lat]
        ]);

        // Create a turf.js point feature from the current boat position
        const boatPoint = turf.point([state.currentPosition.lon, state.currentPosition.lat]);

        // Turf returns length in supported units (e.g., kilometers, miles, radians, degrees).
        // Use kilometers and convert to meters for display.
        const distanceInKilometers = turf.pointToLineDistance(boatPoint, startline, {
            units: 'kilometers'
        });

        // Convert kilometers to meters.
        const distanceInMeters = distanceInKilometers * 1000;

        // Determine which side of the line the boat is currently on.
        const currentSideSign = calculatePointSideSign(state.startboat, state.lineEnd, state.currentPosition);

        // First non-zero side observed after the line is set is treated as pre-start (positive).
        if (state.preStartSideSign === null && currentSideSign !== 0) {
            state.preStartSideSign = currentSideSign;
        }

        let signedDistance = distanceInMeters;
        if (state.preStartSideSign !== null && currentSideSign !== 0) {
            signedDistance = currentSideSign === state.preStartSideSign
                ? distanceInMeters
                : -distanceInMeters;
        }

        // Store calculated distance in state
        state.distance = signedDistance;

        console.log('Distance to startline:', signedDistance.toFixed(2), 'meters');
    } catch (error) {
        console.error('Error calculating distance:', error);
        state.distance = null;
    }
}

function calculatePointSideSign(lineStart, lineEnd, point) {
    const originLat = lineStart.lat;
    const originLon = lineStart.lon;
    const scaleY = 110540;
    const scaleX = 111320 * Math.cos(degreesToRadians((lineStart.lat + lineEnd.lat + point.lat) / 3));

    const lineVectorX = (lineEnd.lon - originLon) * scaleX;
    const lineVectorY = (lineEnd.lat - originLat) * scaleY;
    const pointVectorX = (point.lon - originLon) * scaleX;
    const pointVectorY = (point.lat - originLat) * scaleY;

    const cross = (lineVectorX * pointVectorY) - (lineVectorY * pointVectorX);
    const epsilon = 0.01;

    if (cross > epsilon) {
        return 1;
    }
    if (cross < -epsilon) {
        return -1;
    }
    return 0;
}

// =============================================================================
// COUNTDOWN CONTROL HELPERS
// Start/stop/resume timer, sync to full minute, and reset to 5:00.
// =============================================================================
function toggleCountdown() {
    if (state.raceStarted) {
        return;
    }

    if (state.countdownRunning) {
        state.countdownRunning = false;
        state.countdownLastTickTime = null;
        stopTimerLoop();
        updateCountdownControls();
        console.log('Countdown stopped.');
        return;
    }

    state.countdownRunning = true;
    state.countdownLastTickTime = Date.now();
    startTimerLoop();
    updateCountdownControls();
    console.log('Countdown started/resumed.');
}

function syncCountdown() {
    if (!canSyncCountdown()) {
        return;
    }

    const oneMinuteMs = 60 * 1000;
    const roundedMs = Math.floor(state.countdownRemainingMs / oneMinuteMs) * oneMinuteMs;
    state.countdownRemainingMs = Math.max(oneMinuteMs, roundedMs);

    updateCountdownDisplay();
    updateCountdownControls();
    console.log('Countdown synced to nearest full minute.');
}

function resetCountdown() {
    if (state.countdownRunning || state.raceStarted) {
        return;
    }

    state.countdownRemainingMs = 5 * 60 * 1000;
    state.countdownLastTickTime = null;

    updateCountdownDisplay();
    updateCountdownControls();
    console.log('Countdown reset to 05:00.');
}

function startTimerLoop() {
    if (state.timerIntervalId !== null) {
        return;
    }

    state.timerIntervalId = setInterval(handleTimerTick, 200);
}

function stopTimerLoop() {
    if (state.timerIntervalId === null) {
        return;
    }

    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
}

function handleTimerTick() {
    if (state.raceStarted) {
        updateCountdownDisplay();
        return;
    }

    if (!state.countdownRunning) {
        return;
    }

    const now = Date.now();
    const elapsedSinceLastTick = now - state.countdownLastTickTime;
    state.countdownLastTickTime = now;

    state.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - elapsedSinceLastTick);

    if (state.countdownRemainingMs === 0) {
        state.raceStarted = true;
        state.countdownRunning = false;
        state.raceStartTime = now;
        console.log('Countdown complete. Race started! Now tracking elapsed time.');
    }

    updateCountdownDisplay();
    updateCountdownControls();
}

function canSyncCountdown() {
    return state.countdownRunning && !state.raceStarted && state.countdownRemainingMs > 60 * 1000;
}

function updateCountdownControls() {
    elements.startCountdownBtn.textContent = state.countdownRunning ? 'STOP' : 'START';
    elements.startCountdownBtn.classList.toggle('stop-mode', state.countdownRunning);
    elements.startCountdownBtn.disabled = state.raceStarted;
    elements.syncCountdownBtn.disabled = !canSyncCountdown();
    elements.resetCountdownBtn.disabled = state.raceStarted || state.countdownRunning;
}

function formatClockSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// =============================================================================
// UPDATE COUNTDOWN DISPLAY FUNCTION
// Calculates time remaining (or elapsed) and updates the timer display
// Switches from "MM:SS counting down" to "MM:SS counting up" at T=0
// =============================================================================
function updateCountdownDisplay() {
    if (state.raceStarted) {
        const elapsedSinceStartMs = Date.now() - state.raceStartTime;
        const elapsedSeconds = Math.floor(elapsedSinceStartMs / 1000);
        elements.timerValue.textContent = formatClockSeconds(elapsedSeconds);
        return;
    }

    const countdownSeconds = Math.max(0, Math.ceil(state.countdownRemainingMs / 1000));
    elements.timerValue.textContent = formatClockSeconds(countdownSeconds);
}

// =============================================================================
// UPDATE GPS STATUS DISPLAY
// Updates the GPS status indicator with current connection state and styling
// =============================================================================
function updateGPSStatus(status) {
    state.gpsStatus = status;

    // Map status to user-friendly display text
    const statusTexts = {
        'initializing': 'GPS: Initializing...',
        'acquiring': 'GPS: Acquiring location...',
        'ready': 'GPS: Ready',
        'error': 'GPS: Error - Check permissions'
    };

    // Update the GPS status element text and styling
    elements.gpsStatus.textContent = statusTexts[status] || 'GPS: Unknown';
    elements.gpsStatus.className = `gps-status ${status}`;
}

// =============================================================================
// UPDATE POSITION STATUS DISPLAY
// Shows which startline positions have been captured (visual feedback)
// =============================================================================
function updatePositionStatusDisplay() {
    // Update start boat position display
    if (state.startboat) {
        elements.startBoatStatus.textContent = `${state.startboat.lat.toFixed(5)}, ${state.startboat.lon.toFixed(5)}`;
        elements.markStartBoatBtn.classList.add('marked');
    } else {
        elements.startBoatStatus.textContent = 'Tap to save current GPS position';
        elements.markStartBoatBtn.classList.remove('marked');
    }

    // Update line end position display
    if (state.lineEnd) {
        elements.lineEndStatus.textContent = `${state.lineEnd.lat.toFixed(5)}, ${state.lineEnd.lon.toFixed(5)}`;
        elements.markLineEndBtn.classList.add('marked');
    } else {
        elements.lineEndStatus.textContent = 'Tap to save current GPS position';
        elements.markLineEndBtn.classList.remove('marked');
    }
}

// =============================================================================
// UPDATE UI DISPLAY FUNCTION
// Master function that updates all metric displays with current state values
// Called on each GPS update to refresh distance, speed, bearing, and other metrics
// =============================================================================
function updateUIDisplay() {
    refreshDataQuality();

    // Update distance display
    if (state.distance !== null) {
        elements.distanceValue.textContent = Math.round(state.distance);
    } else {
        elements.distanceValue.textContent = '--';
    }

    // Update boat speed display with extra precision for debugging
    if (state.boatSpeed !== null) {
        elements.speedValue.textContent = state.boatSpeed.toFixed(2);
    } else {
        elements.speedValue.textContent = '--';
    }
    elements.speedValue.classList.toggle('derived-fallback', state.speedDisplaySource === 'derived');

    // Update bearing display with extra precision for debugging
    if (state.bearing !== null) {
        elements.bearingValue.textContent = state.bearing.toFixed(1);
    } else {
        elements.bearingValue.textContent = '--';
    }
    elements.bearingValue.classList.toggle('derived-fallback', state.bearingDisplaySource === 'derived');

    // Update timer display (handles countdown → elapsed time transition)
    updateCountdownDisplay();

    // Update current GPS coordinates display for reference
    if (state.currentPosition) {
        elements.currentPosInfo.textContent = `${state.currentPosition.lat.toFixed(6)}, ${state.currentPosition.lon.toFixed(6)}`;
    } else {
        elements.currentPosInfo.textContent = 'Acquiring...';
    }

    if (state.lastPositionTimestamp) {
        const lastFixTime = new Date(state.lastPositionTimestamp);
        elements.lastPositionTime.textContent = `Last fix: ${lastFixTime.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })}`;
    } else {
        elements.lastPositionTime.textContent = 'Last fix: --:--:--';
    }

    updateQualityIndicators();
}

// =============================================================================
// APPLICATION STARTUP
// Executes when the DOM is fully loaded
// Calls the initialization function to set up the app
// =============================================================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('DOM loaded. Starting application...');
    initializeApp();
});
