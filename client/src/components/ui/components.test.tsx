import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Mail, Search } from 'lucide-react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AnnouncerProvider } from '@/a11y/Announcer';
import { axeViolations } from '@/test/axe';
import { BottomSheet, type Snap } from './BottomSheet';
import { Button, IconButton } from './Button';
import { Card, CardHeader } from './Card';
import { Chip } from './Chip';
import { RadioGroup, RangeField } from './Choice';
import { Dialog } from './Dialog';
import { EmptyState, Skeleton } from './Feedback';
import { Input, Select } from './Input';
import { StatusBadge } from './StatusBadge';
import { TabPanel, Tabs } from './Tabs';
import { Toggle } from './Toggle';
import { TOAST_MS, ToastProvider, useToast } from './Toast';

beforeAll(async () => {
  await i18n.changeLanguage('fr');
});

describe('component library: axe audit', () => {
  it('has no violations in a showcase of every component', async () => {
    const { container } = render(
      <AnnouncerProvider>
        <ToastProvider>
          <main>
            <Button icon={Search}>Rechercher</Button>
            <Button loading>Enregistrement</Button>
            <Button disabled>Indisponible</Button>
            <IconButton icon={Search} label="Rechercher" badge={2} />
            <Input label="E-mail" icon={Mail} hint="Compte universitaire" error="Obligatoire" />
            <Select label="Étage">
              <option>Rez-de-chaussée</option>
            </Select>
            <div role="group" aria-label="Besoins">
              <Chip mode="checkbox" selected>
                Fauteuil roulant
              </Chip>
              <Chip selected={false}>Malvoyant</Chip>
            </div>
            <Toggle checked label="Guidage audio" hint="Lecture à voix haute" onChange={() => undefined} />
            <RadioGroup legend="Thème" name="t" value="a" onChange={() => undefined} options={[{ value: 'a', label: 'Clair' }, { value: 'b', label: 'Sombre' }]} />
            <RangeField label="Taille du texte" value={1.5} min={1} max={2} step={0.25} onChange={() => undefined} format={(v) => `${v * 100} %`} />
            <Tabs idBase="t" label="Vue" value="a" onChange={() => undefined} items={[{ value: 'a', label: 'Carte' }, { value: 'b', label: 'Liste' }]} />
            <TabPanel idBase="t" value="a" active>
              Carte
            </TabPanel>
            <TabPanel idBase="t" value="b" active={false}>
              Liste
            </TabPanel>
            {(['AVAILABLE', 'TEACHER', 'ADMIN', 'CLUB'] as const).map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
            <Card aria-labelledby="c1">
              <CardHeader title="Carte" titleId="c1" />
              <p>Contenu</p>
            </Card>
            <Skeleton.Group>
              <Skeleton className="h-4" />
            </Skeleton.Group>
            <EmptyState icon={Search} title="Rien" text="Aucun résultat" />
          </main>
        </ToastProvider>
      </AnnouncerProvider>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Button', () => {
  it('stays focusable but inert when disabled or loading', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Envoyer
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Envoyer' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    button.focus();
    expect(button).toHaveFocus();
  });

  it('requires a label on icon-only buttons and includes the badge count', () => {
    render(<IconButton icon={Search} label="Notifications" badge={3} />);
    expect(screen.getByRole('button', { name: 'Notifications (3)' })).toBeInTheDocument();
  });
});

describe('Input', () => {
  it('links hint and error with aria-describedby and marks invalid', () => {
    render(<Input label="E-mail" hint="Compte universitaire" error="Adresse invalide" />);
    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Compte universitaire Adresse invalide');
  });
});

describe('Toggle', () => {
  it('is a switch that toggles with click and keyboard, and writes its state', async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Toggle checked={on} onChange={setOn} label="Contraste élevé" />;
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Contraste élevé' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveTextContent('Désactivé');
  });
});

describe('Tabs', () => {
  function Harness() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return <Tabs idBase="x" label="Vue" value={v} onChange={setV} items={[{ value: 'a', label: 'Carte' }, { value: 'b', label: 'Liste' }, { value: 'c', label: 'Audio' }]} />;
  }

  it('uses a roving tabindex and arrow keys (with wrap-around, Home, End)', async () => {
    render(<Harness />);
    const [a, b, c] = screen.getAllByRole('tab');
    expect(a).toHaveAttribute('tabindex', '0');
    expect(b).toHaveAttribute('tabindex', '-1');
    a!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{End}');
    expect(c).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(a).toHaveFocus();
  });

  it('mirrors the arrow keys in RTL', async () => {
    document.documentElement.dir = 'rtl';
    render(<Harness />);
    const [a, b] = screen.getAllByRole('tab');
    a!.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(b).toHaveFocus();
    document.documentElement.dir = 'ltr';
  });
});

describe('StatusBadge', () => {
  it.each([
    ['AVAILABLE', 'pattern-solid', 'Disponible'],
    ['TEACHER', 'pattern-stripes', 'En cours (Dr)'],
    ['CLUB', 'pattern-dots', 'Occupée — club'],
  ] as const)('%s: icon + label + pattern', (status, pattern, label) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(container).toHaveTextContent(label);
    expect(container.querySelector(`.${pattern}`)).not.toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('prefers the server label when given', () => {
    render(<StatusBadge status="CLUB" label="Occupied — club" />);
    expect(screen.getByText('Occupied — club')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('traps focus, closes on Escape and returns focus to the opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Ouvrir</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Fermer la passerelle ?" description="Les itinéraires seront recalculés.">
            <button>Confirmer</button>
          </Dialog>
        </>
      );
    }
    render(
      <div id="root">
        <Harness />
      </div>,
    );
    const opener = screen.getByRole('button', { name: 'Ouvrir' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Fermer la passerelle ?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Les itinéraires seront recalculés.');
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('BottomSheet', () => {
  it('moves between 3 snap points from its 48 px handle (keys and click)', async () => {
    function Harness() {
      const [snap, setSnap] = useState<Snap>('peek');
      return (
        <BottomSheet open title="A-104" snap={snap} onSnapChange={setSnap}>
          <p>Contenu</p>
        </BottomSheet>
      );
    }
    render(<Harness />);
    const region = screen.getByRole('region', { name: 'A-104' });
    const handle = screen.getByRole('button', { name: /Redimensionner le panneau \(actuel : réduit\)/ });
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(region).toHaveAttribute('data-snap', 'half');
    await userEvent.keyboard('{Home}');
    expect(region).toHaveAttribute('data-snap', 'full');
    await userEvent.keyboard('{ArrowDown}');
    expect(region).toHaveAttribute('data-snap', 'half');
    fireEvent.click(handle);
    expect(region).toHaveAttribute('data-snap', 'full');
    expect(await axeViolations(region)).toEqual([]);
  });
});

describe('Toast', () => {
  it('announces in a polite live region, errors in an assertive one, and auto-dismisses info', async () => {
    vi.useFakeTimers();
    function Trigger() {
      const toast = useToast();
      return (
        <>
          <button onClick={() => toast.show('Itinéraire enregistré.', { tone: 'success' })}>ok</button>
          <button onClick={() => toast.show('Serveur injoignable.', { tone: 'error' })}>ko</button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('ko'));
    const polite = screen.getByText('Itinéraire enregistré.').closest('[aria-live]');
    const assertive = screen.getByText('Serveur injoignable.').closest('[aria-live]');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.queryByText('Itinéraire enregistré.')).toBeNull();
    expect(screen.getByText('Serveur injoignable.')).toBeInTheDocument(); // errors stay
    vi.useRealTimers();
  });
});
