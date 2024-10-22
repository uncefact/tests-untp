import React, { useContext, useEffect } from 'react';
import { Box, Button, Tab, Tabs, useMediaQuery, useTheme } from '@mui/material';
import { VerifiableCredential } from '@vckit/core-types';
import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined';

import CredentialRender from '../CredentialRender/CredentialRender';
import { JsonBlock } from '../JsonBlock';
import { VerifyPageContext } from '../../hooks/VerifyPageContext';

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { vc } = useContext(VerifyPageContext);

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

  /**
   * handle click on download button
   */
  const handleClickDownloadVC = async () => {
    const element = document.createElement('a');
    const file = new Blob([JSON.stringify({ verifiableCredential: vc }, null, 2)], {
      type: 'text/plain',
    });
    element.href = URL.createObjectURL(file);
    element.download = 'vc.json';
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
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
        <Button
          variant='text'
          startIcon={<CloudDownloadOutlinedIcon sx={{ marginRight: '5px' }} />}
          sx={{
            color: 'primary.main',
            textTransform: 'none',
            marginLeft: 2,
            paddingRight: 0,
            justifyContent: 'end',
            fontSize: '16px',
            '.MuiButton-startIcon': { marginRight: 0 },
          }}
          onClick={handleClickDownloadVC}
        >
          {isMobile ? '' : 'Download'}
        </Button>
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
