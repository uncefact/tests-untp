import React, { useEffect } from 'react';
import { Box, Tab, Tabs, useMediaQuery, useTheme } from '@mui/material';

import CredentialRender from '../CredentialRender/CredentialRender';
import { JsonBlock } from '../JsonBlock';
import { CredentialComponentProps } from '../../types/common.types';
import { DownloadCredentialButton } from '../DownloadCredentialButton/DownloadCredentialButton';

const CredentialTabs = ({ credential, decodedEnvelopedVC }: CredentialComponentProps) => {
  const credentialTabs = [
    {
      label: 'Rendered',
      children: <CredentialRender credential={decodedEnvelopedVC ?? credential} />,
    },
    {
      label: 'JSON',
      children: <JsonBlock credential={decodedEnvelopedVC ?? credential} />,
    },
  ];

  const [currentTabIndex, setCurrentTabIndex] = React.useState(0);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    configDefaultTabs();
  }, [credential]);

  const configDefaultTabs = () => {
    if (decodedEnvelopedVC?.render?.[0]?.template) {
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
      {value === index && <Box>{children}</Box>}
    </div>
  );

  return (
    <Box sx={{ width: '100%', bgcolor: 'background.paper', minHeight: '300px' }}>
      {/* Header Row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexDirection: isMobile ? 'row' : 'row',
          gap: isMobile ? 1 : 2,
          maxWidth: '800px',
          margin: 'auto',
        }}
      >
        {/* Tabs aligned to the left */}
        <Tabs
          value={currentTabIndex}
          onChange={handleChange}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            justifyContent: 'flex-start',
          }}
          variant='scrollable'
          scrollButtons={isMobile ? 'auto' : false}
        >
          {credentialTabs.map((item, index) => (
            <Tab key={index} label={item.label} />
          ))}
        </Tabs>

        {/* Download Button */}
        <DownloadCredentialButton credential={credential} />
      </Box>

      {/* Tab Panels */}
      {credentialTabs.map((item, index) => (
        <TabPanel key={index} value={currentTabIndex} index={index}>
          {item.children}
        </TabPanel>
      ))}
    </Box>
  );
};

export default CredentialTabs;
