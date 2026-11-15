# CONTRIBUTING & TEAM COLLABORATION
## Firework Chronos – NASA Space Apps Challenge 2026

Welcome to the development documentation of **Firework Chronos**!

Firework Chronos is a satellite-based fire monitoring and analysis platform designed to harmonise historical fire observations from NASA's MODIS and VIIRS datasets.

This document outlines how our project team collaborates, maintains the codebase, documents technical decisions and improves the platform.

---

## 1. Project Vision

Our goal is to transform fragmented satellite fire observations into a consistent, comparable and uncertainty-aware historical fire record.

The platform aims to support:

- Long-term fire activity analysis.
- Regional and seasonal fire comparisons.
- Satellite observation harmonisation.
- Interactive geographical visualisation.
- Research and environmental decision support.

## 2. Team Collaboration

Firework Chronos is developed through collaboration across multiple technical areas.

Our team works across the following areas:

| Area | Responsibilities |
|---|---|
| Frontend Development | User interface, interactive globe, dashboards and visualisation |
| Backend Development | APIs, server-side logic and database integration |
| Data Engineering | Satellite data processing, cleaning and harmonisation |
| Research & Analysis | Scientific methodology, validation and interpretation |
| Documentation | Technical references, setup guides and project knowledge |

Team members may contribute across multiple areas depending on project requirements.

## 3. Development Principles

We follow a few important principles while developing the platform:

**Scientific Reliability**
- Preserve the distinction between MODIS and VIIRS observations.
- Document assumptions and calibration methods.
- Report uncertainty instead of hiding limitations.
- Avoid unsupported conclusions.

**Maintainable Development**
- Keep modules organised and reusable.
- Write meaningful variable and function names.
- Avoid unnecessary duplication.
- Document important implementation decisions.

**Consistent User Experience**
- Maintain a consistent visual language.
- Keep dashboards readable and accessible.
- Make data sources and simulated content clearly identifiable.

## 4. Technical Contribution Areas

Contributions can be made across the following project components.

### Frontend
- React-based interface improvements.
- Interactive Earth visualisation.
- Fire activity charts and calendar views.
- Responsive layouts and navigation.

### Backend
- FastAPI endpoint development.
- API response handling.
- Database integration.
- Error handling and performance improvements.

### Data & Research
- MODIS and VIIRS data processing.
- Common-grid normalisation.
- Calibration and harmonisation.
- Validation and uncertainty analysis.

### Documentation
- Architecture documentation.
- Installation and configuration guides.
- API references.
- Research methodology and technical explanations.

## 5. Team Contribution Record

To maintain transparency, team members should document their work as the project evolves.

Each contribution can include:

| Field | Description |
|---|---|
| Contributor | Name of the team member |
| Contribution Area | Frontend, backend, research, data or documentation |
| Work Completed | Description of the actual implementation |
| Files Modified | Relevant repository paths |
| Verification | Tests or checks performed |
| Commit / PR | Link to the contribution |

This helps maintain a clear record of individual contributions and makes future project maintenance easier.

## 6. Git Workflow

We encourage team members to work on separate branches rather than making direct changes to the main branch.

### Create a branch

```bash
git switch main
git pull origin main
git switch -c feature/your-feature-name
```

### Save and commit changes

```bash
git status
git add <file-name>
git commit -m "feat: describe your change"
```

### Push your branch

```bash
git push -u origin feature/your-feature-name
```

After pushing, create a Pull Request for review and integration.

## 7. Commit Message Convention

Use descriptive commit messages:

| Prefix | Purpose |
|---|---|
| `feat:` | New functionality |
| `fix:` | Bug fixes |
| `docs:` | Documentation changes |
| `refactor:` | Code restructuring |
| `test:` | Test-related changes |
| `chore:` | Maintenance |

Examples:

```text
feat: improve fire activity dashboard
fix: handle missing satellite observations
docs: document calibration workflow
test: add backend API validation
```

## 8. Testing & Quality Assurance

Before submitting changes:

- Verify that the application runs correctly.
- Run relevant backend tests.
- Check API responses and error handling.
- Validate data transformations where applicable.
- Ensure existing functionality remains unaffected.
- Update documentation when implementation changes.

## 9. Data Integrity & Responsible Usage

Since this project deals with satellite observations and environmental analysis, data integrity is essential.

Contributors should:

- Clearly distinguish real satellite observations from simulated demo data.
- Preserve original data-source references.
- Document processing assumptions.
- Avoid presenting fire detections as equivalent to burned area.
- Communicate uncertainty and limitations.
- Avoid describing the platform as a life-safety alert system.

## 10. Security & Configuration

- Never commit API keys, access tokens or passwords.
- Keep local environment files private.
- Use `.env.example` for configuration references.
- Do not expose database credentials in source code.
- Follow existing repository security practices.

## 11. Future Development

Potential areas for continued development include:

- Integration of additional satellite datasets.
- Improved satellite-specific calibration.
- Advanced fire activity analytics.
- AI-assisted fire-risk modelling.
- Expanded geographical coverage.
- Researcher-friendly APIs and data exports.

Future capabilities should be clearly distinguished from features already implemented.

---

## 12. Acknowledgement

Firework Chronos is a collaborative effort built through shared research, engineering, experimentation and continuous improvement.

Every meaningful contribution—from improving a single component to documenting a scientific methodology—helps strengthen the project.

**Built collaboratively. Driven by satellite science. Focused on understanding global fire activity.**

*Firework Chronos | NASA Space Apps Challenge 2026*