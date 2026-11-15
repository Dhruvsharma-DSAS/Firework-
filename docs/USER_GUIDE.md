# FIREWORK CHRONOS — User Guide

## 1. Introduction

Firework Chronos is a satellite-based fire data exploration platform developed for NASA Space Apps 2026.

It brings together MODIS and VIIRS fire observations through an interactive 3D Earth globe, temporal analysis, regional calendars, and data visualisations.

The platform is designed for researchers, analysts, students, and anyone interested in understanding global fire activity.

> **Note:** Firework Chronos is a research decision-support platform, not a life-safety alert system.

## 2. Getting Started

### Accessing the Platform

Open the deployed application:

https://firework-nasa.vercel.app

### Running Locally

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

**Backend (Optional)**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

The frontend can operate with demo fixtures when the backend is unavailable.

## 3. Exploring the Platform

### Home
- Explore the interactive Earth visualisation.
- Understand the MODIS and VIIRS satellite systems.
- Discover the platform workflow and capabilities.

### Explorer
- Drag to rotate and scroll to zoom the 3D Earth globe.
- Explore individual fire detection points.
- View detection information through the inspector.
- Use the seven-day time strip to explore observations.
- Explore satellite tracks and fire-density patterns.

### Calendar
- Explore fire activity using a year-by-month heatmap.
- Select a region to examine temporal patterns.
- Compare raw, harmonised, and VIIRS observations.
- Explore cell-days and exposure-rate views.

### Sensor Lab
- Switch between MODIS and VIIRS observations.
- Examine sensor-specific detection patterns.
- Explore platform-level comparisons and calibration information.

### Data Studio
- Upload a CSV file directly in the browser.
- Map uploaded columns to the expected data fields.
- Validate uploaded data.
- Visualise accepted data points on the globe.

### Formulas
- Browse the platform's 46-formula index.
- Explore formula documentation and audit verdicts.
- Understand calculations supporting the research workflow.

### Validation
- Explore the predefined validation gates (G1–G12).
- Review the validation framework and its status.

### Sources
- Explore detections by probable source classification.
- Review supporting evidence and source information.

### Blind Spot
- Explore the 24-hour observation coverage clock.
- Understand detection patterns by local solar hour.
- Examine coverage scenarios.

### Learn
- Access six learning lessons in English and Hinglish.
- Explore explanations and common fire-data myths.

### Workspace
- Save and revisit browser-based views.

### Brief
- Access a printable report-page template.

### Health
- Review source availability and status information.

## 4. Understanding the 3D Globe

The globe is the central visualisation interface.

Users can:
- Drag to rotate the Earth.
- Scroll to zoom in and out.
- Hover over visual elements to inspect tooltips.
- Click a detection or nearby globe location to inspect the nearest detection.
- Use continent navigation controls to move to specific regions.

The globe includes:

| Visual Layer | Purpose |
|---|---|
| Earth imagery | Displays the Earth using satellite imagery |
| Detection points | Represents individual fire observations |
| Density hexagons | Highlights areas with concentrated detections |
| Pulses | Highlights selected and high-FRP observations |
| Borders | Provides geographic orientation |
| Satellite tracks | Displays satellite movement and observation paths |

## 5. Understanding MODIS and VIIRS

Firework Chronos works with two major satellite sensor systems.



