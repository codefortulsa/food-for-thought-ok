// Used to implement Google Analaytics with React Router 4
// Taken from here: https://github.com/react-ga/react-ga/wiki/React-Router-v4-withTracker
import { useEffect } from 'react';
import ReactGA, { FieldsObject } from 'react-ga';
import { RouteComponentProps } from 'react-router-dom';

// Initialize
ReactGA.initialize(process.env.REACT_APP_GOOGLE_ANALYTICS_TRACKING_CODE || '');

const withGaTracker = <P extends RouteComponentProps>(
  WrappedComponent: React.ComponentType<P>,
  options: FieldsObject = {}
) => {
  const trackPage = (page: string) => {
    ReactGA.set({ page, ...options });
    ReactGA.pageview(page);
  };

  return (props: P) => {
    useEffect(() => {
      trackPage(props.location.pathname);
    }, [props.location.pathname]);

    return <WrappedComponent {...props} />;
  };
};

export default withGaTracker;
