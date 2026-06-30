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

    // Boat speed extracted from GPS data (in knots)
    boatSpeed: null,

    // Boat heading/bearing from GPS data (in degrees, 0-360)
    bearing: null,

    // Timestamp when countdown was started (used to calculate elapsed time)
    countdownStartTime: null,

    // Whether the race countdown has been initiated
    countdownActive: false,

    // Whether the race has officially started (countdown reached zero)
    raceStarted: false,

    // GPS status: 'initializing', 'acquiring', 'ready', or 'error'
    gpsStatus: 'initializing',

    // Timestamp of the last successful GPS position fix
    lastPositionTimestamp: null,

    // Geolocation watchId (needed to stop watching GPS updates)
    watchId: null
};

// =============================================================================
// DOM ELEMENT REFERENCES
// Cache frequently accessed DOM elements for performance
// =============================================================================
const elements = {
    // Buttons
    markStartBoatBtn: document.getElementById('markStartBoatBtn'),
    markLineEndBtn: document.getElementById('markLineEndBtn'),
    startCountdownBtn: document.getElementById('startCountdownBtn'),

    // Status displays
    gpsStatus: document.getElementById('gpsStatus'),
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
    elements.startCountdownBtn.addEventListener('click', startCountdown);

    // Start continuous GPS tracking
    initializeGPSTracking();

    console.log('App initialization complete');
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

    // Extract boat speed from GPS (in m/s, convert to knots: m/s ÷ 0.51444)
    // If GPS doesn't provide speed data, set to null
    state.boatSpeed = coords.speed !== null ? coords.speed / 0.51444 : null;

    // Extract bearing/heading from GPS (in degrees, 0-360)
    // If GPS doesn't provide heading, set to null
    state.bearing = coords.heading !== null ? coords.heading : null;

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
        speed: state.boatSpeed ? state.boatSpeed.toFixed(2) : 'N/A',
        bearing: state.bearing ? state.bearing.toFixed(0) : 'N/A'
    });
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
// Enables the "Start Countdown" button once both startline endpoints are set
// =============================================================================
function checkAndEnableCountdownButton() {
    if (state.startboat && state.lineEnd) {
        elements.startCountdownBtn.disabled = false;
        console.log('Both startline positions set. Countdown button enabled.');
    }
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

        // Store calculated distance in state
        state.distance = distanceInMeters;

        console.log('Distance to startline:', distanceInMeters.toFixed(2), 'meters');
    } catch (error) {
        console.error('Error calculating distance:', error);
        state.distance = null;
    }
}

// =============================================================================
// START COUNTDOWN FUNCTION
// Initiates the 5-minute countdown timer
// Records the start time and begins a timer interval that updates every 100ms
// =============================================================================
function startCountdown() {
    // Prevent multiple countdown starts
    if (state.countdownActive) {
        return;
    }

    // Record the current time as the countdown start reference
    // Countdown will run for 5 minutes (300000 milliseconds)
    const fiveMinutesMs = 5 * 60 * 1000;
    state.countdownStartTime = Date.now();
    state.countdownActive = true;

    // Disable the buttons during countdown
    elements.markStartBoatBtn.disabled = true;
    elements.markLineEndBtn.disabled = true;
    elements.startCountdownBtn.disabled = true;

    console.log('Countdown started. Race begins in 5 minutes.');

    // Start a timer that updates every 100ms
    // This provides smooth countdown display without consuming too much CPU
    const timerInterval = setInterval(() => {
        updateCountdownDisplay();

        // Check if countdown has reached zero
        const elapsedTime = Date.now() - state.countdownStartTime;
        if (elapsedTime >= fiveMinutesMs) {
            // Countdown reached zero, switch to counting up (race time)
            state.raceStarted = true;
            clearInterval(timerInterval);

            console.log('Countdown complete. Race started! Now tracking elapsed time.');
        }
    }, 100);
}

// =============================================================================
// UPDATE COUNTDOWN DISPLAY FUNCTION
// Calculates time remaining (or elapsed) and updates the timer display
// Switches from "MM:SS counting down" to "MM:SS counting up" at T=0
// =============================================================================
function updateCountdownDisplay() {
    // If countdown hasn't been started, show the default 5 minutes
    if (!state.countdownActive) {
        elements.timerValue.textContent = '05:00';
        return;
    }

    // Calculate how much time has elapsed since countdown started
    const elapsedMs = Date.now() - state.countdownStartTime;
    const fiveMinutesMs = 5 * 60 * 1000;

    let displaySeconds;

    // Before T=0: count down (show time remaining)
    if (!state.raceStarted) {
        const remainingMs = fiveMinutesMs - elapsedMs;
        displaySeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    }
    // After T=0: count up (show elapsed time since race start)
    else {
        const raceElapsedMs = elapsedMs - fiveMinutesMs;
        displaySeconds = Math.floor(raceElapsedMs / 1000);
    }

    // Convert total seconds to MM:SS format
    const minutes = Math.floor(displaySeconds / 60);
    const seconds = displaySeconds % 60;

    // Format with leading zeros (e.g., "04:32" not "4:32")
    const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    elements.timerValue.textContent = formattedTime;
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
        elements.startBoatStatus.classList.add('set');
    } else {
        elements.startBoatStatus.textContent = 'Not set';
        elements.startBoatStatus.classList.remove('set');
    }

    // Update line end position display
    if (state.lineEnd) {
        elements.lineEndStatus.textContent = `${state.lineEnd.lat.toFixed(5)}, ${state.lineEnd.lon.toFixed(5)}`;
        elements.lineEndStatus.classList.add('set');
    } else {
        elements.lineEndStatus.textContent = 'Not set';
        elements.lineEndStatus.classList.remove('set');
    }
}

// =============================================================================
// UPDATE UI DISPLAY FUNCTION
// Master function that updates all metric displays with current state values
// Called on each GPS update to refresh distance, speed, bearing, and other metrics
// =============================================================================
function updateUIDisplay() {
    // Update distance display
    if (state.distance !== null) {
        elements.distanceValue.textContent = Math.round(state.distance);
    } else {
        elements.distanceValue.textContent = '--';
    }

    // Update boat speed display (convert m/s to knots, or show '--' if unavailable)
    if (state.boatSpeed !== null) {
        elements.speedValue.textContent = state.boatSpeed.toFixed(2);
    } else {
        elements.speedValue.textContent = '--';
    }

    // Update bearing display (show heading in degrees, or '--' if unavailable)
    if (state.bearing !== null) {
        elements.bearingValue.textContent = Math.round(state.bearing);
    } else {
        elements.bearingValue.textContent = '--';
    }

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
