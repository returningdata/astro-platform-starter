// Change Logs Data
// Edit this file to add new change logs for the site

export interface ChangeLog {
  id: string;
  version: string;
  date: string; // Format: YYYY-MM-DD
  category: 'feature' | 'improvement' | 'bugfix' | 'content' | 'security';
  title: string;
  description: string;
  changes: string[];
}

export const changeLogs: ChangeLog[] = [
  {
    id: '1',
    version: '1.0.0',
    date: '2025-11-23',
    category: 'feature',
    title: 'Initial Launch - DPPD Officer Hub',
    description: 'Complete redesign and launch of the Del Perro Police Department Officer Hub website.',
    changes: [
      'Created new homepage with officer dashboard and quick access cards',
      'Implemented About DPPD page with mission statement, core values, and awards',
      'Built Chain of Command page with embedded live roster from Google Sheets',
      'Developed Resources page with links to SOPs, Promotion Guidelines, and Authority Matrix',
      'Created Community Events page with editable event management system',
      'Added Change Logs page for tracking site updates',
      'Updated branding with DPPD blue color scheme and police shield iconography',
      'Implemented responsive design for mobile and tablet devices'
    ]
  },
  {
    id: '2',
    version: '1.0.1',
    date: '2025-11-23',
    category: 'content',
    title: 'Sample Community Events Added',
    description: 'Added initial set of community events to demonstrate the events system.',
    changes: [
      'Added Community Safety Forum event',
      'Added Citizens Police Academy program',
      'Added National Night Out celebration',
      'Added Holiday Toy Drive',
      'Added Coffee with a Cop event'
    ]
  }
];
