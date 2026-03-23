import { LabIcon } from '@jupyterlab/ui-components';
import bellOutline from '../style/icons/bell-outline.svg';
import bellFilled from '../style/icons/bell-filled.svg';
import bellOff from '../style/icons/bell-off.svg';
import bellAlert from '../style/icons/bell-alert.svg';
import bellClock from '../style/icons/bell-clock.svg';

export const bellOutlineIcon = new LabIcon({
  name: 'notify:bell-outline',
  svgstr: bellOutline,
});

export const bellFilledIcon = new LabIcon({
  name: 'notify:bell-filled',
  svgstr: bellFilled,
});

export const bellOffIcon = new LabIcon({
  name: 'notify:bell-off',
  svgstr: bellOff,
});

export const bellAlertIcon = new LabIcon({
  name: 'notify:bell-alert',
  svgstr: bellAlert,
});

export const bellClockIcon = new LabIcon({
  name: 'notify:bell-clock',
  svgstr: bellClock,
});
