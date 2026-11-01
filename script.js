// eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJvb0lJcGhhb1dBazVwSFZKak1XSEJvcnkwaHlwek1EM204ZU42MElfMWJBIiwiaWF0IjoxNzkzNTM5MjY1fQ.7AqV5MrMOGwruw1a6jX5ML7l3WL5dfW1x4PsRJz_nYY

const STOP_ID = '204420'

async function GTFS(file) { //for each of the txt files
    const response = await fetch(`gtfs/${file}`);
    const text = await response.text();
    return Papa.parse(text, {header: true, skipEmptyLines: true}).data;
}

function minsUntil(departureTime) {
    const now = new Date();
    const currentMins = now.getHours()*60+now.getMinutes();
    const [hours,minutes]=departureTime.split(':').map(Number);
    const departureMins = hours*60+minutes;
    return departureMins - currentMins
}

async function loadDepartures() {
    const container = document.getElementById('departures-container');
    const header = document.getElementById('stop-header');
    
    try {
        const [stopTimes, trips, routes, stops, calendar] = await Promise.all([
            GTFS('stop_times.txt'),
            GTFS('trips.txt'),
            GTFS('routes.txt'),
            GTFS('stops.txt'),
            GTFS('calendar.txt')
        ]);

        const parentStop = stops.find(s=>s.stop_id === STOP_ID);
        header.textContent = parentStop ? parentStop.stop_name : 'stop name error';
        const parentName = parentStop ? parentStop.stop_name: '';
        const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        const today = days[new Date().getDay()];
        const currentServices = new Set(
            calendar.filter(c => c[today] === '1').map(c => c.service_id)
        );
        const validStopIds = stops
            .filter(s => s.stop_id === STOP_ID || s.parent_station === STOP_ID)
            .map(s => s.stop_id);
        const departures = stopTimes
            .filter(st => validStopIds.includes(st.stop_id))
            .map(st => {
                const trip = trips.find(t => t.trip_id === st.trip_id) || {};
                if (!currentServices.has(trip.service_id)) return null;
                const route = routes.find(r => r.route_id === trip.route_id) || {};
                const minsLeft = minsUntil(st.departure_time);
                const platform = stops.find(s => s.stop_id === st.stop_id);
                const platformName = platform ? platform.stop_name.replace(parentName,'').trim():'';
                return {
                    route_short_name: route.route_short_name || '',
                    route_color: route.route_color || '000000',
                    route_text_color: route.route_text_color || 'FFFFFF',
                    trip_headsign: trip.trip_headsign || '',
                    departure_time: st.departure_time,
                    mins_left: minsLeft,
                    platform_name: platformName
                };
            })
            .filter(d => d !== null && d.mins_left >0)
            .sort((a,b) => a.mins_left-b.mins_left)
            .slice(0,10);
        
        container.innerHTML = '';
        const template = document.getElementById('departures-template');
        if (departures.length ===0) {
            container.textContent = 'No upcoming departures'
            return;
        }
        departures.forEach(d => {
            const clone = template.content.cloneNode(true);
            const routeName = clone.querySelector('.route-name');
            routeName.textContent = d.route_short_name;
            routeName.style.backgroundColor =  `#${d.route_color}`;
            routeName.style.color =  `#${d.route_text_color}`;
            clone.querySelector('.headsign').textContent = d.trip_headsign;
            clone.querySelector('.platform-name').textContent = d.platform_name;
            clone.querySelector('.time-left').textContent = d.mins_left=== 0 ? 'Now' : `${d.mins_left}m`;
            container.appendChild(clone);
        })
            
    } catch (error) {
        container.textContent = 'error loading';
    }
}

loadDepartures();
setInterval(loadDepartures,60000)