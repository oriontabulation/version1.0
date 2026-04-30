# Orion Tabulation System

A modern, client-side debate tournament tabulation system built for speech and debate competitions. Orion supports multiple debate formats with real-time scoring, judge management, and comprehensive tournament administration.

## Features

### Debate Formats
- **British Parliamentary (BP)** - 4-team format (Opening Gov, Opening Opp, Closing Gov, Closing Opp)
- **Standard Debate** - 2-team format (Government vs Opposition)
- **Speech Tournament** - Individual speaker events with customizable room sizes

### Tournament Management
- **Multiple Draw Methods**: Random, Power (seeded by wins), Balanced (fold pairing)
- **Side Preference System**: Random, Alternate (no repeat), Balanced (equal over time)
- **Round Robin** support for round-robin tournaments
- **Knockout/Elimination** rounds with automatic bracket generation
- **Blind rounds** for unbiased judging
- **Bye management** for odd numbers of teams

### Judge Management
- **Auto-allocation** of judges to debates
- **Chair and Wing** judge roles
- **Judge conflicts** - prevent judges from certain teams
- **Drag-and-drop** judge assignment
- **Judge feedback** system
- **Panel management** per debate room

### Scoring & Results
- **Real-time score entry** with validation
- **Reply speech** toggle for standard debates
- **Speaker rankings** and break calculations
- **Team standings** with win/loss records
- **Speech results** with individual speaker scoring

### User Roles
- **Admin** - Full tournament control, draw creation, results entry
- **Judge** - Portal access for ballot submission and feedback
- **Guest** - Public view of draws and results

### Authentication
- **Supabase Auth** integration for secure login
- **Local auth fallback** when offline
- **Role-based access control** (JWT-based)

## Technology Stack

- **Frontend**: Vanilla JavaScript (ES Modules), HTML5, CSS3
- **Backend**: Supabase (Auth, Database, Realtime)
- **Build**: Vite
- **Testing**: Vitest (unit), Playwright (e2e)
- **Monitoring**: Sentry (error tracking)
- **Styling**: Custom CSS with CSS variables for theming
## Usage

### Creating a Tournament
1. Register as an admin user
2. Add teams via the Teams tab
3. Add judges via the Judges tab
4. Create rounds using the Draw tab
5. Enter results after each debate

### Judge Portal
Judges can access their dedicated portal to:
- View assigned debates
- Submit ballots/results
- Provide feedback on debates

### Configuration
- **Format Selection**: Choose BP, Standard, or Speech mode
- **Theme Customization**: Change accent colors via the theme picker
- **Side Preference**: Configure how sides are assigned (Random/Alternate/Balanced)
- **Display Options**: Toggle between team names and codes

## Key Features Implemented

### Draw System
- Pairing methods: Random, Power (seed-based), Fold (balanced)
- Side assignment: Random, Seed-based (high/low), Manual
- Side preference: Alternate (no repeat), Balanced (equal distribution)
- Room URL generation for public viewing

### Scoring System
- Customizable speaker scores
- Team points and rankings
- Speaker individual rankings
- Break calculations for elimination rounds

### Data Management
- LocalStorage persistence
- Supabase cloud sync
- Export capabilities
- Offline support with local auth

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test:unit` - Run unit tests
- `npm run test:e2e` - Run end-to-end tests
- `npm run lint` - Lint JavaScript files

## Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers (responsive design)

## License



## Contributing



## Support

For issues and feature requests, please use oriontabulation@gmail.com.
