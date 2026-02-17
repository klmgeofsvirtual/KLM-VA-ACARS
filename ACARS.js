(function() {
    console.log("KLM Console: Initializing Physics & SOPs...");

    if (document.getElementById('klm-widget')) document.getElementById('klm-widget').remove();
    const ui = document.createElement('div');
    ui.id = 'klm-widget';
    ui.style = 'position:fixed;top:70px;right:10px;background:rgba(10,20,35,0.95);border-left:5px solid #00A1DE;padding:15px;width:240px;z-index:10000000;font-family:sans-serif;color:white;border-radius:4px;box-shadow:0 4px 15px rgba(0,0,0,0.6);';
    ui.innerHTML = `<div style="font-weight:bold;color:#00A1DE;">KLM Console</div><div id="acars-status" style="font-size:11px;">Connecting...</div><div id="acars-main"><input type="text" id="pilot-id" placeholder="Discord ID" style="width:100%;margin:5px 0;color:black;"><button id="connect-btn" style="width:100%;background:#00A1DE;color:white;border:none;cursor:pointer;padding:5px;">CONNECT</button></div>`;
    document.body.appendChild(ui);

    async function init() {
        const load = (url) => new Promise(r => { const s = document.createElement('script'); s.src = url; s.onload = r; document.head.appendChild(s); });
        if (typeof firebase === 'undefined') {
            await load('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
            await load('https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js');
        }
        const config = { apiKey: "AIzaSyBNM1Xc7a64GIlOiBiwJ5hE9Ci6EK1lxuo", projectId: "klm-dispatch" };
        if (!firebase.apps.length) firebase.initializeApp(config);
        const db = firebase.firestore();
        document.getElementById('acars-status').innerText = "Database Online.";

        document.getElementById('connect-btn').onclick = async () => {
            const id = document.getElementById('pilot-id').value.trim();
            const snap = await db.collection('bookings').where('pilot.discordId', '==', id).limit(1).get();
            if (snap.empty) { document.getElementById('acars-status').innerText = "NO BOOKING FOUND"; }
            else { startMonitor(db, id, snap.docs[0].data(), snap.docs[0].id); }
        };
    }

    function startMonitor(db, pilotId, flight, docId) {
        document.getElementById('acars-main').innerHTML = `<div style="color:#22c55e;">SENSORS ACTIVE</div><div id="telemetry" style="font-size:10px;margin-top:5px;"></div>`;
        
        let isGrounded = true;
        let lastBreachTime = 0;
        let oldAGL = 0;
        let oldTime = Date.now();

        // HIGH FREQUENCY LOOP (50ms) - For Landings/Taxi
        setInterval(() => {
            if (!window.geofs || !geofs.animation) return;
            const vals = geofs.animation.values;
            const now = Date.now();
            
            // Terrain-calibrated AGL
            const currentAGL = (vals.altitude - vals.groundElevationFeet) + (geofs.aircraft.instance.collisionPoints[geofs.aircraft.instance.collisionPoints.length - 2].worldPosition[2] * 3.2808);
            const calVS = (currentAGL - oldAGL) * (60000 / (now - oldTime));
            oldAGL = currentAGL;
            oldTime = now;

            // TAXI CHECK
            if (vals.groundContact && vals.groundSpeedKnt > 26) {
                logBreach("TAXI_OVERSPEED", `${Math.round(vals.groundSpeedKnt)}kts on ground`);
            }

            // LANDING CHECK
            if (vals.groundContact && !isGrounded) {
                const finalVS = Math.abs(calVS);
                const gForce = vals.accZ / 9.80665;
                if (finalVS > 600 || gForce > 2.5) {
                    logBreach("GASA_INCIDENT", `Hard Landing: ${Math.round(finalVS)}fpm @ ${gForce.toFixed(2)}G`);
                }
                db.collection('bookings').doc(docId).update({ landingVS: Math.round(finalVS), landingG: gForce.toFixed(2) });
            }

            // OVERSPEED CHECK
            if (!vals.groundContact && currentAGL < 3000 && vals.kias > 250) {
                logBreach("OVERSPEED", `${Math.round(vals.kias)}kts @ ${Math.round(currentAGL)}ft`);
            }

            isGrounded = vals.groundContact;
            document.getElementById('telemetry').innerText = `SPD: ${Math.round(vals.kias)} | AGL: ${Math.round(currentAGL)}`;
        }, 50);

        function logBreach(type, details) {
            if (now - lastBreachTime < 10000) return;
            lastBreachTime = now;
            db.collection('breaches').add({
                pilotId: pilotId,
                type: type,
                details: details || "No extra info",
                flight: flight.flightNumber || "KLM-UNKN",
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    }
    init();
})();
