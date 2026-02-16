(function() {
    /* 1. UI Setup - Ensure clean start */
    if (document.getElementById('klm-widget')) document.getElementById('klm-widget').remove();
    
    const ui = document.createElement('div');
    ui.id = 'klm-widget';
    ui.style = 'position:fixed;top:70px;right:10px;background:rgba(10,20,35,0.98);border-left:5px solid #00A1DE;padding:15px;width:230px;z-index:1000000;font-family:sans-serif;color:white;border-radius:0 5px 5px 0;box-shadow: 0 4px 15px rgba(0,0,0,0.5);';
    ui.innerHTML = `
        <div style="font-weight:bold;color:#00A1DE;font-size:16px;margin-bottom:10px;">KLM ACARS 6.3</div>
        <div id="acars-status" style="font-size:12px;">Initializing...</div>
        <div id="acars-main">
            <input type="text" id="pilot-id" placeholder="Discord ID" style="width:100%;margin-top:10px;padding:5px;color:black;">
            <button id="connect-btn" style="width:100%;margin-top:5px;background:#00A1DE;border:none;color:white;padding:8px;font-weight:bold;cursor:pointer;">CONNECT</button>
        </div>
    `;
    document.body.appendChild(ui);

    /* 2. Resilient Notification & UI Updater */
    const updateStatus = (text) => {
        const el = document.getElementById('acars-status');
        if (el) el.innerText = text;
    };

    const safeNotify = (msg, color = "white") => {
        console.log(`[ACARS ALERT] ${msg}`);
        if (window.geofs && geofs.notifications && typeof geofs.notifications.show === 'function') {
            geofs.notifications.show(msg, color);
        }
    };

    /* 3. Smarter Script Loader (Avoids Double-Loading Firebase) */
    const loadScript = (url, globalCheck) => {
        return new Promise((resolve) => {
            if (window[globalCheck] || (globalCheck === 'firebase' && typeof firebase !== 'undefined')) {
                return resolve();
            }
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = resolve; // Continue even on error to avoid hanging
            document.head.appendChild(script);
        });
    };

    async function init() {
        updateStatus("Loading Firebase...");
        await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js', 'firebase');
        await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js', 'firestore');
        
        try {
            const config = { apiKey: "AIzaSyBNM1Xc7a64GIlOiBiwJ5hE9Ci6EK1lxuo", projectId: "klm-dispatch" };
            if (!firebase.apps.length) firebase.initializeApp(config);
            const db = firebase.firestore();
            
            updateStatus("Ready for Dispatch.");

            const connectBtn = document.getElementById('connect-btn');
            if (connectBtn) {
                connectBtn.onclick = async () => {
                    const idInput = document.getElementById('pilot-id');
                    const id = idInput ? idInput.value.trim() : null;
                    if(!id) return;

                    updateStatus("Syncing...");
                    const snap = await db.collection('bookings')
                        .where('pilot.discordId', '==', id)
                        .where('status', 'in', ['BOOKED', 'SCHEDULED', 'TEST', 'DEPARTED', 'EN ROUTE'])
                        .limit(1).get();

                    if (snap.empty) {
                        updateStatus("No Booking Found.");
                    } else {
                        const flight = snap.docs[0].data();
                        startMonitor(db, id, flight, snap.docs[0].id);
                    }
                };
            }
        } catch (e) {
            updateStatus("System Error.");
            console.error(e);
        }
    }

    function startMonitor(db, id, flight, docId) {
        const mainArea = document.getElementById('acars-main');
        if (mainArea) {
            mainArea.innerHTML = `
                <div style="font-size:18px;margin-top:5px;font-weight:bold;">${flight.flightNumber}</div>
                <div style="font-size:11px;color:#cbd5e1;margin-bottom:10px;">${flight.departure} ➔ ${flight.destination}</div>
                <div id="sop-live" style="font-size:10px;color:#22c55e;">SOP MONITOR: ONLINE</div>
            `;
        }
        updateStatus("Status: ACTIVE");

        let lastAlt = 0;
        let cruiseCounter = 0;
        let lastBreachTime = 0;

        setInterval(() => {
            if (!window.geofs || !geofs.animation || !geofs.animation.values) return;
            const ani = geofs.animation.values;
            
            // --- AUTO ENROUTE ---
            if (flight.status === "DEPARTED" && ani.altitude > 8000) {
                if (Math.abs(ani.altitude - lastAlt) < 15) {
                    cruiseCounter++;
                    if (cruiseCounter > 30) {
                        db.collection('bookings').doc(docId).update({status: "EN ROUTE"});
                        flight.status = "EN ROUTE";
                        updateStatus("Status: EN ROUTE (Auto)");
                        safeNotify("CRUISE REACHED: EN ROUTE", "#00A1DE");
                    }
                } else { cruiseCounter = 0; }
            }
            lastAlt = ani.altitude;

            // --- SOP INSPECTOR ---
            const logBreach = (type, details) => {
                if (Date.now() - lastBreachTime < 30000) return;
                lastBreachTime = Date.now();

                db.collection('breaches').add({
                    pilotId: id,
                    type: type,
                    details: details,
                    flight: flight.flightNumber,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                safeNotify(`SOP BREACH: ${type}`, "red");
            };

            if (ani.altitude < 3000 && ani.kias > 210) {
                logBreach("OVERSPEED_LOW_ALT", `${Math.round(ani.kias)}kts at ${Math.round(ani.altitude)}ft`);
            }
        }, 2000);
    }

    init();
})();
