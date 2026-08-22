import './characterization/commands.test.ts';
import './characterization/interaction.test.ts';
import './characterization/lenses.test.ts';
import './contracts/architecture.test.ts';
import './contracts/document.test.ts';
import './core/document-store.test.ts';
import './core/filter.test.ts';
import './core/profile.test.ts';
import './core/view-state.test.ts';
import { runTests } from './support/harness.ts';

void runTests();
