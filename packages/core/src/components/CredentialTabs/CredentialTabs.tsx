import { Box, Tab, Tabs } from '@mui/material';
import { VerifiableCredential } from '@vckit/core-types';
import React, { useEffect } from 'react';
import CredentialRender from '../CredentialRender/CredentialRender';
import { JsonBlock } from '../JsonBlock';

const CredentialTabs = ({ credential }: { credential: VerifiableCredential }) => {
  const credentialTabs = [
    {
      label: 'Rendered',
      children: <CredentialRender credential={credential} />,
    },
    {
      label: 'JSON',
      children: <JsonBlock credential={credential} />,
    },
  ];

  const [currentTabIndex, setCurrentTabIndex] = React.useState(0);

  useEffect(() => {
    configDefaultTabs();
  }, [credential]);

  const configDefaultTabs = () => {
    if (credential?.render?.[0]?.template) {
      return setCurrentTabIndex(0);
    }

    setCurrentTabIndex(1);
  };

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    event.preventDefault();
    setCurrentTabIndex(newValue);
  };

  const TabPanel = ({ children, value, index, ...other }: any) => (
    <div role='tabpanel' hidden={value !== index} id={`tabpanel-${index}`} aria-labelledby={`tab-${index}`} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );

  return (
    <Box sx={{ width: '100%', bgcolor: 'background.paper', minHeight: '300px' }}>
      <Tabs value={currentTabIndex} onChange={handleChange} centered>
        {credentialTabs?.map((item, index) => <Tab key={index} label={item.label} />)}
      </Tabs>

      {credentialTabs?.map((item, index) => (
        <TabPanel key={index} value={currentTabIndex} index={index} children={item.children} />
      ))}
    </Box>
  );
};

export default CredentialTabs;
