(function() {
    /* 1. UI Setup & Removal of Old Widget */
    if (document.getElementById('klm-widget')) document.getElementById('klm-widget').remove();
    const ui = document.createElement('div');
    ui.id = 'klm-widget';
    ui.style = 'position:fixed;top:70px;right:10px;background:rgba(10,20,35,0.98);border-left:5px solid #00A1DE;padding:15px;width:230px;z-index:1000000;font-family:sans-serif;color:white;border-radius:0 5px 5px 0;box-shadow: 0 4px 15px rgba(0,0,0,0.5);';
    ui.innerHTML = `
        <div style="font-weight:bold;color:#00A1DE;font-size:16px;margin-bottom:10px;">KLM ACARS 6.2</div>
        <div id="acars-status" style="font-size:12px;">Initializing...</div>
        <div id="acars-main">
            <input type="text" id="pilot-id" placeholder="Paste Discord ID" style="width:100%;margin-top:10px;padding:5px;color:black;">
            <button id="connect-btn" style="width:100%;margin-top:5px;background:#00A1DE;border:none;color:white;padding:8px;font-weight:bold;cursor:pointer;">CONNECT</button>
        </div>
    `;
    document.body.appendChild(ui);

    /* 2. Utility: Safe Notification Function */
    const notify = (msg, color = "white") => {
        console.log(`[KLM ACARS] ${msg}`);
        if (window.geofs && geofs.notifications && typeof geofs.notifications.show === "function") {
            geofs.notifications.show(msg, color);
        }
    };

    /* 3. Library Loader */
    const loadScript = (url) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    async function init() {
        try {
            document.getElementById('acars-status').innerText = "Loading Firebase...";
            await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
            await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js');
            
            const config = { apiKey: "AIzaSyBNM1Xc7a64GIlOiBiwJ5hE9Ci6EK1lxuo", projectId: "klm-dispatch" };
            if (!firebase.apps.length) firebase.initializeApp(config);
            const db = firebase.firestore();
            
            document.getElementById('acars-status').innerText = "System Ready.";

            document.getElementById('connect-btn').onclick = async () => {
                const id = document.getElementById('pilot-id').value.trim();
                if(!id) return alert("Please enter your Discord ID");

                document.getElementById('acars-status').innerText = "Fetching Dispatch...";
                const snap = await db.collection('bookings')
                    .where('pilot.discordId', '==', id)
                    .where('status', 'in', ['BOOKED', 'SCHEDULED', 'TEST', 'DEPARTED', 'EN ROUTE'])
                    .orderBy('createdAt', 'desc').limit(1).get();

                if (snap.empty) {
                    document.getElementById('acars-status').innerText = "No Flight Found.";
                } else {
                    const flightData = snap.docs[0].data();
                    const flightId = snap.docs[0].id;
                    startMonitor(db, id, flightData, flightId);
                }
            };
        } catch (e) {
            document.getElementById('acars-status').innerText = "Load Error. Check Console.";
            console.error("KLM ACARS Initialization Failed:", e);
        }
    }

    function startMonitor(db, pilotId, flight, docId) {
        document.getElementById('acars-main').innerHTML = `
            <div style="font-size:18px;margin-top:5px;font-weight:bold;">${flight.flightNumber}</div>
            <div style="font-size:11px;color:#cbd5e1;">${flight.departure} ➔ ${flight.destination}</div>
            <hr style="border:0;border-top:1px solid #334155;margin:10px 0;">
            <div id="sop-indicator" style="font-size:10px;color:#22c55e;">● SOP MONITOR ACTIVE</div>
            <div id="telemetry-box" style="font-size:10px;color:#94a3b8;margin-top:5px;">Waiting for data...</div>
        `;
        
        let currentStatus = flight.status;
        document.getElementById('acars-status').innerText = "Status: " + currentStatus;

        let lastAlt = 0;
        let cruiseCounter = 0;
        let lastBreachTime = 0;

        /* The Monitoring Loop (Every 2 Seconds) */
        const monitorLoop = setInterval(() => {
            if (!window.geofs || !geofs.animation || !geofs.animation.values) return;
            
            const ani = geofs.animation.values;
            const alt = ani.altitude;
            const kias = ani.kias;
            const gs = ani.groundSpeedKnt;
            const grounded = ani.groundContact;

            document.getElementById('telemetry-box').innerHTML = `ALT: ${Math.round(alt)} | KIAS: ${Math.round(kias)}`;

            // --- 1. AUTO EN-ROUTE LOGIC ---
            if (currentStatus === "DEPARTED" && alt > 8000) {
                // If altitude variation is less than 20ft over 60 seconds
                if (Math.abs(alt - lastAlt) < 20) {
                    cruiseCounter++;
                    if (cruiseCounter >= 30) { // 30 ticks * 2s = 60s
                        db.collection('bookings').doc(docId).update({ status: "EN ROUTE" });
                        currentStatus = "EN ROUTE";
                        document.getElementById('acars-status').innerText = "Status: EN ROUTE";
                        notify("CRUISE ALTITUDE REACHED: EN ROUTE", "#00A1DE");
                    }
                } else {
                    cruiseCounter = 0;
                }
            }
            lastAlt = alt;

            // --- 2. SOP BREACH LOGIC ---
            const logBreach = (type, details) => {
                if (Date.now() - lastBreachTime < 30000) return; // 30s debounce
                lastBreachTime = Date.now();
                
                // Log to Firestore
                db.collection('breaches').add({
                    pilotId: pilotId,
                    type: type,
                    details: details,
                    flight: flight.flightNumber,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Trigger Alert
                notify(`SOP BREACH: ${type}`, "red");
            };

            // Rule: Speed below 3000ft
            if (!grounded && alt < 3000 && kias > 210) {
                logBreach("SPEED_BELOW_3K", `${Math.round(kias)} kts at ${Math.round(alt)} ft`);
            }
            
            // Rule: Speed below 10,000ft
            if (!grounded && alt >= 3000 && alt < 10000 && kias > 260) {
                logBreach("SPEED_BELOW_10K", `${Math.round(kias)} kts at ${Math.round(alt)} ft`);
            }

            // Rule: Taxi Speed
            if (grounded && gs > 26) {
                logBreach("TAXI_OVERSPEED", `${Math.round(gs)} kts on ground`);
            }

        }, 2000);
    }

    init();
})();
