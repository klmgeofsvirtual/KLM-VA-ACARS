(function() {
    console.log("Injecting KLM Console...");

    /* 1. Bulletproof UI Setup */
    if (document.getElementById('klm-widget')) {
        document.getElementById('klm-widget').remove();
    }
    
    const ui = document.createElement('div');
    ui.id = 'klm-widget';
    // Extreme z-index to ensure GeoFS overlays don't hide it
    ui.style = 'position:fixed;top:70px;right:10px;background:rgba(10,20,35,0.95);border-left:5px solid #00A1DE;padding:15px;width:240px;z-index:2147483647;font-family:sans-serif;color:white;border-radius:4px;box-shadow:0 4px 15px rgba(0,0,0,0.6);';
    ui.innerHTML = `
        <div style="font-weight:bold;color:#00A1DE;font-size:16px;margin-bottom:10px;">KLM Console</div>
        <div id="acars-status" style="font-size:12px;color:#cbd5e1;margin-bottom:10px;">Loading Database...</div>
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

    const safeNotify = (msg, color = "white") => {
        console.log(`[KLM Console] ${msg}`);
        if (window.geofs && geofs.notifications && typeof geofs.notifications.show === 'function') {
            geofs.notifications.show(msg, color);
        }
    };

    /* 2. Safe Script Loader */
    const loadScript = (url, globalCheck) => {
        return new Promise((resolve) => {
            if (window[globalCheck] || (globalCheck === 'firebase' && typeof window.firebase !== 'undefined')) {
                return resolve();
            }
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = resolve; // Continue even if blocked to avoid hanging
            document.head.appendChild(script);
        });
    };

    /* 3. Core Logic */
    async function init() {
        await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js', 'firebase');
        await loadScript('https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js', 'firestore');
        
        try {
            const config = { apiKey: "AIzaSyBNM1Xc7a64GIlOiBiwJ5hE9Ci6EK1lxuo", projectId: "klm-dispatch" };
            if (!firebase.apps.length) firebase.initializeApp(config);
            const db = firebase.firestore();
            
            updateStatus("Awaiting Pilot ID...");

            document.getElementById('connect-btn').onclick = async () => {
                const id = document.getElementById('pilot-id').value.trim();
                if(!id) return;

                updateStatus("Searching Bookings...", "yellow");
                const snap = await db.collection('bookings')
                    .where('pilot.discordId', '==', id)
                    .where('status', 'in', ['BOOKED', 'SCHEDULED', 'TEST', 'DEPARTED', 'EN ROUTE'])
                    .limit(1).get();

                if (snap.empty) {
                    updateStatus("No Active Flight Found.", "red");
                } else {
                    const flightData = snap.docs[0].data();
                    const docId = snap.docs[0].id;
                    startMonitor(db, id, flightData, docId);
                }
            };
        } catch (e) {
            updateStatus("Connection Error.", "red");
            console.error(e);
        }
    }

    function startMonitor(db, pilotId, flight, docId) {
        document.getElementById('acars-main').innerHTML = `
            <div style="font-size:18px;font-weight:bold;color:white;">${flight.flightNumber || "KLM FLIGHT"}</div>
            <div style="font-size:11px;color:#cbd5e1;margin-bottom:8px;">${flight.departure || "DEP"} ➔ ${flight.destination || "ARR"}</div>
            <button id="depart-btn" style="width:100%;background:#22c55e;border:none;color:white;padding:6px;font-weight:bold;cursor:pointer;border-radius:3px;margin-bottom:5px;">DEPART</button>
            <div id="sop-live" style="font-size:10px;color:#22c55e;margin-top:5px;">● TELEMETRY ONLINE</div>
        `;
        updateStatus(`Status: ${flight.status || "ACTIVE"}`, "#38bdf8");

        // UI Buttons
        document.getElementById('depart-btn').onclick = () => {
            db.collection('bookings').doc(docId).update({ status: "DEPARTED" });
            updateStatus("Status: DEPARTED", "#22c55e");
            flight.status = "DEPARTED";
            document.getElementById('depart-btn').remove();
        };

        // Physics Variables
        let isGrounded = true;
        let bounces = 0;
        let lastBreachTime = 0;
        let oldAGL = 0;
        let oldTime = Date.now();
        let calVertS = 0;
        let lastAlt = 0;
        let cruiseCounter = 0;

        // --- HIGH FREQUENCY PHYSICS LOOP (25ms) ---
        setInterval(() => {
            if (!window.geofs || !geofs.animation || !geofs.aircraft.instance) return;
            
            const vals = geofs.animation.values;
            const collisionPoints = geofs.aircraft.instance.collisionPoints;
            if (!collisionPoints || collisionPoints.length < 2) return;

            const currentAGL = (vals.altitude - vals.groundElevationFeet) + (collisionPoints[collisionPoints.length - 2].worldPosition[2] * 3.2808);
            
            const now = Date.now();
            if (now - oldTime > 0) {
                calVertS = (currentAGL - oldAGL) * (60000 / (now - oldTime));
            }
            oldAGL = currentAGL;
            oldTime = now;

            const justLanded = (vals.groundContact && !isGrounded);
            
            // LANDING SENSOR
            if (justLanded) {
                const finalVS = Math.abs(calVertS);
                const gForce = vals.accZ / 9.80665;
                
                console.log(`[KLM Console] TOUCHDOWN -> V/S: -${finalVS.toFixed(0)} | G: ${gForce.toFixed(2)}`);

                if (finalVS < 150) safeNotify("BUTTER! Silk Landing", "#38bdf8");

                if (finalVS > 600 || gForce > 2.5) {
                    safeNotify("⚠️ GASA INCIDENT: HARD LANDING", "red");
                    db.collection('breaches').add({
                        pilotId: pilotId,
                        type: "GASA_INCIDENT",
                        details: `Hard Landing: -${Math.round(finalVS)} fpm | ${gForce.toFixed(2)}G`,
                        flight: flight.flightNumber || "Unknown",
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }

                db.collection('bookings').doc(docId).update({
                    landingVS: `-${finalVS.toFixed(0)}`,
                    landingG: gForce.toFixed(2),
                    bounces: bounces
                });
            }

            // BOUNCE SENSOR
            if (!vals.groundContact && isGrounded && currentAGL < 20) {
                bounces++;
                safeNotify(`BOUNCE DETECTED (${bounces})`, "orange");
            }

            isGrounded = vals.groundContact;
        }, 25);

        // --- LOW FREQUENCY SOP & STATUS LOOP (2000ms) ---
        setInterval(() => {
            if (!window.geofs || !geofs.animation) return;
            const vals = geofs.animation.values;
            
            // AUTO ENROUTE
            if (flight.status === "DEPARTED" && vals.altitude > 8000) {
                if (Math.abs(vals.altitude - lastAlt) < 20) {
                    cruiseCounter++;
                    if (cruiseCounter >= 30) {
                        db.collection('bookings').doc(docId).update({ status: "EN ROUTE" });
                        flight.status = "EN ROUTE";
                        updateStatus("Status: EN ROUTE", "#38bdf8");
                        safeNotify("AUTO-ENROUTE REACHED", "#00A1DE");
                    }
                } else { cruiseCounter = 0; }
            }
            lastAlt = vals.altitude;

            // SOP BREACH LOGGER
            const logBreach = (type, details) => {
                if (Date.now() - lastBreachTime < 15000) return; // 15 sec cooldown
                lastBreachTime = Date.now();
                
                db.collection('breaches').add({
                    pilotId: pilotId,
                    type: type,
                    details: details,
                    flight: flight.flightNumber || "Unknown",
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }).then(() => console.log(`[KLM Console] Breach sent to Discord: ${type}`))
                  .catch(err => console.error("Firebase Write Error:", err));

                safeNotify(`SOP BREACH: ${type}`, "red");
            };

            // SOP RULES
            if (vals.groundContact && vals.groundSpeedKnt > 26) {
                logBreach("TAXI_OVERSPEED", `${Math.round(vals.groundSpeedKnt)}kts on ground`);
            }
            if (!vals.groundContact && vals.altitude < 3000 && vals.kias > 210) {
                logBreach("OVERSPEED_LOW_ALT", `${Math.round(vals.kias)}kts below 3000ft`);
            }
        }, 2000);
    }

    init();
})();
