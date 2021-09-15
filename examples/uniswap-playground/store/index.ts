import { makeAutoObservable } from 'mobx';
import { Action, ActionRequestParams, Asset, CurrencySymbol, Log } from 'types';
import { getEndpointRequestBody } from 'utils/helpers';
import { callEndpoint, pab } from 'utils/pab';

const SYMBOL: CurrencySymbol = {};
const CONTRACTS_BY_WALLETS: { [key: string]: string } = {};

type LoadingModule = 'actions' | 'assets';

class Store {
  loadings: { [key in LoadingModule]: boolean } = {
    actions: false,
    assets: true,
  };
  globalError: string | null = null;
  wallets: string[] = [];
  currentWallet: string = '';
  funds: Asset[] = [];
  pools: Asset[] = [];
  logs: Log[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  initProject = async () => {
    const pabExists = await pab.checkPabExists();
    if (!pabExists) {
      this.setGlobalError('PAB does not exist');
      this.setLoadingAll(false);
      return;
    }

    this.addRequestsLogging();

    try {
      // define CONTRACTS
      const contracts = await pab.getContracts();
      contracts.forEach((contract, i) => {
        const wallet = contract.cicWallet.getWalletId;
        CONTRACTS_BY_WALLETS[wallet] = contract.cicContract.unContractInstanceId;
        this.wallets.push(wallet);
        if (i === 0) this.setCurrentWallet(wallet);
      });

      // define SYMBOL
      const state = await callEndpoint(CONTRACTS_BY_WALLETS[this.currentWallet], 'funds', []);
      const symbol = state.observableState.Right.contents.getValue.find((el: any) =>
        el[1].every((el: any) => ['A', 'B', 'C', 'D'].includes(el[0].unTokenName))
      )?.[0].unCurrencySymbol;
      if (!symbol) throw new Error(`SYMBOL: ${symbol}`);
      this.createLog('SUCCESS', `SYMBOL: ${symbol}`);
      SYMBOL.unCurrencySymbol = symbol;

      await this.fetchAssets('funds');
      await this.fetchAssets('pools');
    } catch (err: any) {
      this.setGlobalError('Initialization error');
      console.error(err);
      this.createLog('ERROR', `Initialization error\n\n${err?.message}`);
      this.setLoadingAll(false);
    }
  };

  addRequestsLogging = () => {
    pab.axios.interceptors.response.use(
      (response) => {
        const { url, method, data } = response.config;
        const log = {
          type: 'INFO' as const,
          time: new Date(),
          message: `${String(method).toUpperCase()} ${url}` + (data ? `\n\ndata: ${data}` : ''),
        };
        this.addLog(log);

        return response;
      },
      (error) => {
        const { config, status, data } = error.response;
        const { url, method } = config;
        const log = {
          type: 'WARNING' as const,
          time: new Date(),
          message: `Error ${status} ${method.toUpperCase()} ${url}\n\n${data}`,
        };
        this.addLog(log);

        return Promise.reject(error);
      }
    );
  };

  setGlobalError = (errorText: string) => {
    this.globalError = errorText;
  };

  setLoading = (loadingModule: LoadingModule, isLoading: boolean) => {
    this.loadings = { ...this.loadings, [loadingModule]: isLoading };
  };

  setLoadingAll = (isLoading: boolean) => {
    (Object.keys(this.loadings) as LoadingModule[]).forEach(
      (key) => (this.loadings[key] = isLoading)
    );
  };

  setFunds = (funds: Asset[]) => {
    this.funds = funds;
  };

  setPools = (pools: Asset[]) => {
    this.pools = pools;
  };

  addLog = (log: Log) => {
    this.logs = [...this.logs, log];
  };

  createLog = (type: Log['type'], message: string) => {
    this.logs = [...this.logs, { type, message, time: new Date() }];
  };

  setCurrentWallet = (walletNumber: string) => {
    this.currentWallet = walletNumber;
  };

  switchWallet = (walletNumber: string) => {
    this.setCurrentWallet(walletNumber);
    this.fetchAssets('funds');
  };

  callAction = async (actionName: Action, params: ActionRequestParams) => {
    this.setLoadingAll(true);
    const contractId = CONTRACTS_BY_WALLETS[this.currentWallet];

    try {
      const body = getEndpointRequestBody(actionName, params, SYMBOL);
      await callEndpoint(contractId, actionName, body);
      this.createLog('SUCCESS', `Action "${actionName}"`);
      this.setLoading('actions', false);

      await this.fetchAssets('funds');
      await this.fetchAssets('pools');
    } catch (err: any) {
      console.error(err);
      this.createLog('ERROR', `Action request: "${actionName}"\n\n${err?.message}`);
      this.setLoadingAll(false);
    }
  };

  fetchAssets = async (type: 'funds' | 'pools') => {
    this.setLoading('assets', true);
    const contractId = CONTRACTS_BY_WALLETS[this.currentWallet];

    try {
      const state = await callEndpoint(contractId, type, []);
      const assets: Asset[] = [];

      if (type === 'funds') {
        state.observableState.Right.contents.getValue.forEach(
          ([{ unCurrencySymbol }, arr]: any) => {
            arr.forEach((el: any) => {
              assets.push({
                currencySymbol: unCurrencySymbol,
                tokenName: el[0].unTokenName,
                amount: el[1],
              });
            });
          }
        );
        this.setFunds(assets);
      }

      if (type === 'pools') {
        state.observableState.Right.contents.forEach((el: any) => {
          el.forEach((el: any) => {
            assets.push({
              currencySymbol: el[0].unAssetClass[0].unCurrencySymbol,
              tokenName: el[0].unAssetClass[1].unTokenName,
              amount: el[1],
            });
          });
        });
        this.setPools(assets);
      }

      this.createLog('SUCCESS', `Assets request: "${type}"`);
    } catch (err: any) {
      console.error(err);
      this.createLog('ERROR', `Assets request: "${type}"\n\n${err?.message}`);
    }
    this.setLoading('assets', false);
  };
}

export const store = new Store();
