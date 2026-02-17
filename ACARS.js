(function() {
    console.log("Injecting KLM Console...");

    /* 1. UI Setup */
    if (document.getElementById('klm-widget')) document.getElementById('klm-widget').remove();
    const ui = document.createElement('div');
    ui.id = 'klm-widget';
    ui.style = 'position:fixed;top:70px;right:10px;background:rgba(10,20,35,0.95);border-left:5px solid #00A1DE;padding:15px;width:240px;z-index:2147483647;font-family:sans-serif;color:white;border-radius:4px;box-shadow:0 4px 15px rgba(0,0,0,0.6);';
    ui.innerHTML = `
        <div style="font-weight:bold;color:#00A1DE;font-size:16px;margin-bottom:10px;">KLM Console</div>
        <div id="acars-status" style="font-size:12px;color:#cbd5e1;margin-bottom:10px;">Initializing...</div>
        <div id="acars-main">
            <input type="text" id="pilot-id" placeholder="Discord ID" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:6px;color:black;border-radius:3px;border:none;">
            <button id="connect-btn" style="width:100%;background:#00A1DE;border:none;color:white;padding:8px;font-weight:bold;cursor:pointer;border-radius:3px;">CONNECT</button>
        </div>
    `;
    document.body.appendChild(ui);

    const updateStatus = (text, color = "#cbd5e1") => {
        const el = document.getElementById('acars-status');
        if (el) { el.innerText = text; el.style.color = color; }
    };

    /* 2. Library Loader */
    const loadScript = (url, globalCheck) => {
        return new Promise((resolve) => {
            if (window[globalCheck] || (globalCheck === 'firebase' && typeof window.firebase !== 'undefined')) return resolve();
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
        });
    };

    /* 3. The Init Function (This was the missing part!) */
    async function init() {
        updateStatus("Loading Firebase...");
        await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js', 'firebase');
        await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js', 'firestore');
        
        try {
            const config = { apiKey: "AIzaSyBNM1Xc7a64GIlOiBiwJ5hE9Ci6EK1lxuo", projectId: "klm-dispatch" };
            if (!firebase.apps.length) firebase.initializeApp(config);
            const db = firebase.firestore();
            updateStatus("Ready.");

            document.getElementById('connect-btn').onclick = async () => {
                const id = document.getElementById('pilot-id').value.trim();
                if(!id) return;
                updateStatus("Searching...");
                const snap = await db.collection('bookings')
                    .where('pilot.discordId', '==', id)
                    .where('status', 'in', ['BOOKED', 'SCHEDULED', 'DEPARTED', 'EN ROUTE'])
                    .limit(1).get();

                if (snap.empty) {
                    updateStatus("No Flight Found.", "red");
                } else {
                    startMonitor(db, id, snap.docs[0].data(), snap.docs[0].id);
                }
            };
        } catch (e) {
            updateStatus("Error connecting.", "red");
            console.error(e);
        }
    }

    function startMonitor(db, pilotId, flight, docId) {
        document.getElementById('acars-main').innerHTML = `
            <div style="font-size:18px;font-weight:bold;">${flight.flightNumber}</div>
            <div style="font-size:11px;color:#cbd5e1;margin-bottom:8px;">${flight.departure} ➔ ${flight.destination}</div>
            <div id="sop-live" style="font-size:10px;color:#22c55e;">● SENSORS ONLINE</div>
        `;
        updateStatus(`Status: ${flight.status}`, "#38bdf8");

        let lastBreachTime = 0;

        // Monitor Loop
        setInterval(() => {
            if (!window.geofs || !geofs.animation) return;
            const vals = geofs.animation.values;
            
            if (vals.kias > 210 && (vals.altitude - vals.groundElevationFeet) < 3000 && !vals.groundContact) {
                if (Date.now() - lastBreachTime < 15000) return;
                lastBreachTime = Date.now();
                
                db.collection('breaches').add({
                    pilotId: pilotId,
                    type: "OVERSPEED_LOW_ALT",
                    details: `${Math.round(vals.kias)}kts below 3000ft`,
                    flight: flight.flightNumber,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                if (geofs.notifications) geofs.notifications.show("SOP BREACH: OVERSPEED", "red");
            }
        }, 2000);
    }

    // This triggers the code inside the wrapper
    init();
})();
