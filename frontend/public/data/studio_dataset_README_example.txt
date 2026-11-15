DATASET SHEET (README.txt) - keep this file next to your CSV

Title             : Punjab stubble fires, October 2013 - FIRMS sample
Owner / contact   : Team FIREWORK CHRONOS - github.com/Dhruvsharma-DSAS/Firework-
Source and method : NASA FIRMS standard archive, VIIRS S-NPP 375 m (VNP14IMGML), downloaded and filtered to Punjab
Period            : 16-20 October 2013
Area              : Punjab and Haryana, India (29.5-32.5 N, 74-77.5 E)
Coordinates       : WGS84 decimal degrees
Time              : dates and times in UTC (acq_time = HHMM)
Rows              : 200
Columns           : latitude, longitude, acq_date, acq_time, satellite, instrument,
                    confidence (l / n / h), frp (MW), daynight (D / N), bright_ti4 (K)
Known limits      : a row is a hot pixel, not a fire; fires under cloud or outside the
                    overpass times are missed; one field can produce several rows
Status label      : OFFICIAL - copied unchanged from NASA FIRMS
                    (other labels: SOURCE-DERIVED, RUN / TESTED LOCALLY, SIMULATED, PROPOSED)
Licence and credit: NASA open data - "NASA FIRMS, VIIRS S-NPP 375 m active fire product"
