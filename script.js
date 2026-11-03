const STOP_ID = '200070' //can change to any station but also update the github actions python too

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJvb0lJcGhhb1dBazVwSFZKak1XSEJvcnkwaHlwek1EM204ZU42MElfMWJBIiwiaWF0IjoxNzkzNTM5MjY1fQ.7AqV5MrMOGwruw1a6jX5ML7l3WL5dfW1x4PsRJz_nYY'
//container with indivudal updates to give stop ids etc all in binary
const GTFS_RT_PROTO = ` 
syntax="proto2";
message FeedMessage { repeated FeedEntity entity =2;}
message FeedEntity { optional string id = 1; optional TripUpdate trip_update =3;}
message TripUpdate {
    optional TripDescriptor trip =1;
    repeated StopTimeUpdate stop_time_update =2;
}
message TripDescriptor { optional string trip_id =1;}
message StopTimeUpdate {
    optional string stop_id = 4;
    optional StopTimeEvent departure =3;
}
message StopTimeEvent {optional int32 delay =1; optional int64 time =2;}
`;

async function fetchRealtimeDelays() { //for the realtime gtfs delays
    const delays = {};
    try {
        const root = protobuf.parse(GTFS_RT_PROTO).root; //protobuf deocde binary
        const FeedMessage = root.lookupType("FeedMessage");
        const url = 'https://corsproxy.io/?'+encodeURIComponent('https://api.transport.nsw.gov.au/v2/gtfs/realtime/sydneytrains');
        const res = await fetch(url, {
            headers: { 'Authorization': `apikey ${API_KEY}`},
            cache: 'no-store'
        });
        const buffer = await res.arrayBuffer(); //array for the bnary
        const message = FeedMessage.decode(new Uint8Array(buffer)); //decodes the buffer 

        message.entity.forEach(entity => { //this is for each update in message
            const tu = entity.tripUpdate;
            if (!tu || !tu.trip) return; //skip empty
            const tripId = tu.trip.tripId;
            (tu.stopTimeUpdate || []).forEach(stu => { //loops thru each stop update for each trip to check delays
                if (stu.departure && typeof stu.departure.delay === 'number') {
                    delays[`${tripId}_${stu.stopId}`] = stu.departure.delay; //saves delay info against the stop and trip
                    delays[tripId] = stu.departure.delay;
                }
            });
        });
    } catch (e) {
        console.error('realtime fetch failed, fall abck to static', e);
    }
    return delays; //returns created dictionary
}

async function GTFS(file) { //for each of the txt files
    const response = await fetch(`gtfs/${file}`, {cache: 'no-store'});
    const text = await response.text();
    return Papa.parse(text, {header: true, skipEmptyLines: true}).data;
}

function minsUntil(departureTime) {
    const now = new Date(); //get current time
    const currentMins = now.getHours()*60+now.getMinutes();
    const [hours,minutes]=departureTime.split(':').map(Number); //splits  into hrs/mins
    const departureMins = hours*60+minutes;
    return departureMins - currentMins
}

async function loadDepartures() {
    const container = document.getElementById('departures-container');
    const header = document.getElementById('stop-header');
    
    try {
        const [stopTimes, trips, routes, stops, calendar, rtDelays] = await Promise.all([
            GTFS('stop_times.txt'),
            GTFS('trips.txt'),
            GTFS('routes.txt'),
            GTFS('stops.txt'),
            GTFS('calendar.txt'),
            fetchRealtimeDelays()
        ]);

        const parentStop = stops.find(s=>s.stop_id === STOP_ID); //for indivudal platforms to match their parent station id as platforms have their onw stopids
        header.textContent = parentStop ? parentStop.stop_name : 'stop name error';
        const parentName = parentStop ? parentStop.stop_name: ''; //catches if a platform doesnt have a parent
        const now = new Date();
        const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']; //gtfs uses sunday as the week start fun fact
        const today = days[now.getDay()];
        const todayStr = now.getFullYear().toString() +
            String(now.getMonth()+1).padStart(2,'0') +
            String(now.getDate()).padStart(2,'0'); //gives YYYYMMDD format
        const currentServices = new Set(
            calendar
                .filter(c => c[today] === '1' && c.start_date <= todayStr && c.end_date >= todayStr)
                .map(c => c.service_id) //filters to current day of week and makes a set of servie ids that match
        );
        const validStopIds = stops
            .filter(s => s.stop_id === STOP_ID || s.parent_station === STOP_ID)
            .map(s => s.stop_id); //essentially just a big list of all the station ids including platforms etc
        const departures = stopTimes
            .filter(st => validStopIds.includes(st.stop_id))
            .map(st => {
                const trip = trips.find(t => t.trip_id === st.trip_id) || {};
                if (!currentServices.has(trip.service_id)) return null;
                const route = routes.find(r => r.route_id === trip.route_id) || {};
                const delaySec = rtDelays[`${st.trip_id}_${st.stop_id}`] ?? rtDelays[st.trip_id] ?? 0;
                const delayMins = Math.round(delaySec/60);
                const minsLeft = minsUntil(st.departure_time)+delayMins;
                const platform = stops.find(s => s.stop_id === st.stop_id);
                const baseName = parentName.replace(/ Station$/i,''); //remove station from the name
                const platformName = platform ? platform.stop_name.replace(new RegExp(`^${baseName}( Station)?,?\\s*`,'i'),'').trim():''; //in the platform section it takes away the station name so it just shows like platform 1
                return {
                    route_short_name: route.route_short_name || '',
                    route_color: route.route_color || '000000', //default the route to black and white when none come up
                    route_text_color: route.route_text_color || 'FFFFFF',
                    trip_headsign: trip.trip_headsign || '',
                    departure_time: st.departure_time,
                    mins_left: minsLeft,
                    delay_mins: delayMins,
                    platform_name: platformName
                };
            })
            .filter(d => d !== null && d.mins_left >=0) //gets rid of past deparues and any invalids
            .filter((d,index,self) =>
                index === self.findIndex(t => //removes all the duplicate entries that show up
                    t.departure_time === d.departure_time &&
                    t.route_short_name === d.route_short_name &&
                    t.platform_name === d.platform_name
                )
            )
            .sort((a,b) => a.mins_left-b.mins_left) //soonest arrival first ofc
            .slice(0,10); //how many departures it displays
        
        container.innerHTML = '';
        const template = document.getElementById('departures-template');
        if (departures.length ===0) { //really for debugging as in theory therll always be future departures
            container.textContent = 'No upcoming departures'
            return;
        }
        departures.forEach(d => { //each of these clones are just cloning an element of the temaplte in the html so they can essentially be reused infinitely
            const clone = template.content.cloneNode(true);
            const routeName = clone.querySelector('.route-name');
            routeName.textContent = d.route_short_name;
            routeName.style.backgroundColor =  `#${d.route_color}`;
            routeName.style.color =  `#${d.route_text_color}`; //gtfs gives in hex
            clone.querySelector('.headsign').textContent = d.trip_headsign;
            clone.querySelector('.platform-name').textContent = d.platform_name;
            clone.querySelector('.time-left').textContent = d.mins_left=== 0 ? 'Now' : `${d.mins_left}m`; //if 0mins remain then the arrivl is now
            const ontimeEl = clone.querySelector('.ontime');
            if (d.delay_mins <= 0) { //if no delay the on time and green, and vice versa
                ontimeEl.textContent = `On time`;
                ontimeEl.style.color='limegreen';
            } else {
                ontimeEl.textContent =  `${d.delay_mins}m late`;
                ontimeEl.style.color = `red`;
            }
            container.appendChild(clone); //adds the templated clone
        })
            
    } catch (error) {
        container.textContent = 'error loading';
    }
}

loadDepartures();
setInterval(loadDepartures,60000) //refreshes each minute